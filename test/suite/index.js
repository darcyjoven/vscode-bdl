// e2e 测试套件：在真实 VSCode 扩展宿主中验证扩展端到端可用。
//
// 不用 mocha：只需要一个自带的极简断言器，减少依赖与版本漂移。
// 任一用例失败 → run() 抛出 → 宿主退出码非 0。
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vscode = require("vscode");

/** 收集每个用例的结果，最后一次性输出，失败也要跑完其余用例。 */
const results = [];

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err });
    console.error(`  ✗ ${name} (${Date.now() - started}ms)`);
    console.error(`    ${err instanceof Error ? err.stack : String(err)}`);
  }
}

/** 等待某条件成立；超时抛错。 */
async function waitFor(description, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const suffix = lastError ? `，最后一次错误：${lastError}` : "";
  throw new Error(`等待超时：${description}${suffix}`);
}

/** 打开工作区里的 fixture。 */
async function openFixture(name) {
  const root = process.env.BDL_E2E_WORKSPACE;
  assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
  const file = path.join(root, name);
  assert.ok(fs.existsSync(file), `fixture 不存在: ${file}`);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** 取某文档的全部诊断（所有集合）。 */
function diagnosticsFor(uri) {
  return vscode.languages.getDiagnostics(uri);
}

/** 等待文档出现满足条件的诊断。 */
async function waitForDiagnostics(uri, description, predicate, timeoutMs = 30000) {
  return waitFor(
    description,
    () => {
      const all = diagnosticsFor(uri);
      return predicate(all) ? all : undefined;
    },
    timeoutMs,
  );
}

/** 主入口，由扩展测试宿主调用。 */
async function run() {
  console.log("[e2e] 开始扩展端到端测试");

  try {
    // 1. 扩展被激活
    await test("扩展可激活", async () => {
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      assert.ok(ext, "未找到扩展 darcyjoven.4gl-full");
      await ext.activate();
      assert.strictEqual(ext.isActive, true, "扩展未激活");
    });

    // 2. 语言注册正确
    await test("语言注册 bdl/per", async () => {
      const languages = await vscode.languages.getLanguages();
      assert.ok(languages.includes("bdl"), `未注册 bdl，实际: ${languages.join(",")}`);
      assert.ok(languages.includes("per"), "未注册 per");
    });

    // 3. 命令已注册
    await test("命令已注册", async () => {
      const commands = await vscode.commands.getCommands(true);
      for (const id of ["bdl.restartServer", "bdl.showServerInfo", "bdl.showOutput"]) {
        assert.ok(commands.includes(id), `缺少命令 ${id}`);
      }
    });

    // 4. .4gl 被识别为 bdl 语言
    await test("识别 .4gl 语言", async () => {
      const doc = await openFixture("sample.4gl");
      assert.strictEqual(doc.languageId, "bdl", `实际 languageId=${doc.languageId}`);
    });

    // 5. .per 被识别为 per 语言
    await test("识别 .per 语言", async () => {
      const doc = await openFixture("sample.per");
      assert.strictEqual(doc.languageId, "per", `实际 languageId=${doc.languageId}`);
    });

    // 6. 干净文件无诊断（证明 LSP 已连上且没有误报）
    await test("干净文件无诊断", async () => {
      const doc = await openFixture("sample.4gl");
      // 先等 LSP 完成一次诊断发布：broken 文件有诊断即说明连上了
      const broken = await openFixture("broken.4gl");
      await waitForDiagnostics(
        broken.uri,
        "broken.4gl 出现诊断（说明 LSP 已连接）",
        (all) => all.length > 0,
      );
      const clean = diagnosticsFor(doc.uri).filter(
        (d) => d.severity === vscode.DiagnosticSeverity.Error,
      );
      assert.deepStrictEqual(
        clean.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`),
        [],
        "干净文件不应有 error 诊断",
      );
    });

    // 7. 语法错误文件出现 error 波浪线
    await test("语法错误产生 error 诊断", async () => {
      const doc = await openFixture("broken.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "broken.4gl 出现 error 级诊断",
        (list) => list.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
      );
      const errors = all.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
      assert.ok(errors.length > 0, "没有 error 级诊断");
      // 诊断必须落在文件范围内，否则波浪线不可见
      for (const d of errors) {
        assert.ok(
          d.range.start.line < doc.lineCount,
          `诊断行号越界: ${d.range.start.line} >= ${doc.lineCount}`,
        );
        assert.ok(d.message.length > 0, "诊断消息为空");
      }
    });

    // 8. 修复后诊断消失（验证增量同步）
    await test("修复后诊断消失", async () => {
      const doc = await openFixture("broken.4gl");
      const editor = await vscode.window.showTextDocument(doc);
      await waitForDiagnostics(
        doc.uri,
        "broken.4gl 先有诊断",
        (list) => list.length > 0,
      );

      // 把未闭合字符串补上结束引号
      const text = doc.getText();
      const fixed = text.replace(
        'DISPLAY "it\'s unterminated',
        'DISPLAY "it\'s terminated"',
      );
      assert.notStrictEqual(fixed, text, "未能构造出修复后的文本");

      const full = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(text.length),
      );
      await editor.edit((b) => b.replace(full, fixed));

      await waitForDiagnostics(
        doc.uri,
        "修复后诊断清空",
        (list) => list.length === 0,
        20000,
      );

      // 还原，避免影响后续用例
      await editor.edit((b) =>
        b.replace(
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          text,
        ),
      );
    });

    // 9. 文档大纲：应列出 main / function / report / define / type
    await test("文档大纲包含主要符号", async () => {
      const doc = await openFixture("sample.4gl");
      const symbols = await vscode.commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        doc.uri,
      );
      assert.ok(Array.isArray(symbols) && symbols.length > 0, "大纲为空");

      // 递归收集名字
      const names = [];
      const walk = (list) => {
        for (const s of list) {
          names.push(s.name);
          if (s.children) {
            walk(s.children);
          }
        }
      };
      walk(symbols);

      for (const expected of ["main", "show_name", "r_list", "g_count", "t_customer"]) {
        assert.ok(
          names.some((n) => n.toLowerCase() === expected.toLowerCase()),
          `大纲缺少 ${expected}，实际: ${names.join(",")}`,
        );
      }
    });

    // 10. 悬停：函数上应有内容
    await test("函数悬停有内容", async () => {
      const doc = await openFixture("sample.4gl");
      // 找到 show_name 定义行
      const lineIndex = doc
        .getText()
        .split("\n")
        .findIndex((l) => /^\s*FUNCTION\s+show_name/i.test(l));
      assert.ok(lineIndex >= 0, "找不到 FUNCTION show_name 行");
      const col = doc.lineAt(lineIndex).text.toLowerCase().indexOf("show_name");

      const hovers = await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        doc.uri,
        new vscode.Position(lineIndex, col + 2),
      );
      assert.ok(Array.isArray(hovers) && hovers.length > 0, "悬停为空");
      const text = hovers
        .flatMap((h) => h.contents)
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n");
      assert.ok(text.trim().length > 0, "悬停内容为空");
    });

    // 11. 定义跳转：CALL show_name 跳到 FUNCTION show_name
    await test("定义跳转可用", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      const callLine = lines.findIndex((l) => /^\s*CALL\s+show_name/i.test(l));
      assert.ok(callLine >= 0, "找不到 CALL show_name 行");
      const col = doc.lineAt(callLine).text.toLowerCase().indexOf("show_name");

      const definitions = await vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        doc.uri,
        new vscode.Position(callLine, col + 2),
      );
      assert.ok(Array.isArray(definitions) && definitions.length > 0, "定义为空");

      const target = definitions[0];
      const uri = target.uri ?? target.targetUri;
      const range = target.range ?? target.targetRange;
      assert.ok(uri, "定义缺少 uri");
      assert.ok(range, "定义缺少 range");

      // 定义应落在 FUNCTION show_name 那一行
      const defDoc = await vscode.workspace.openTextDocument(uri);
      const defLine = defDoc.lineAt(range.start.line).text;
      assert.ok(
        /FUNCTION\s+show_name/i.test(defLine),
        `定义未落在 FUNCTION 行，实际: ${defLine}`,
      );
    });

    // 12. 引用查找可用
    await test("引用查找可用", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      const defLine = lines.findIndex((l) => /^\s*FUNCTION\s+show_name/i.test(l));
      const col = doc.lineAt(defLine).text.toLowerCase().indexOf("show_name");

      const refs = await vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        doc.uri,
        new vscode.Position(defLine, col + 2),
      );
      assert.ok(Array.isArray(refs), "引用结果不是数组");
      assert.ok(refs.length >= 2, `引用数量过少：${refs.length}（至少应含定义与调用）`);
    });

    // 13. 重启命令把服务器拉回来，功能仍然可用
    await test("重启服务器后仍可用", async () => {
      await vscode.commands.executeCommand("bdl.restartServer");
      const doc = await openFixture("broken.4gl");
      await waitForDiagnostics(
        doc.uri,
        "重启后 broken.4gl 仍有诊断",
        (list) => list.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        40000,
      );
    });

    // 14. 配置变更即时生效：关掉语法诊断后 error 消失
    await test("配置热更新生效", async () => {
      const doc = await openFixture("broken.4gl");
      await waitForDiagnostics(
        doc.uri,
        "配置改动前有 error",
        (list) => list.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
      );

      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "syntaxDiagnostics",
        "off",
        vscode.ConfigurationTarget.Global,
      );

      await waitForDiagnostics(
        doc.uri,
        "syntaxDiagnostics=off 后 error 消失",
        (list) => !list.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        20000,
      );

      // 还原
      await cfg.update(
        "syntaxDiagnostics",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await waitForDiagnostics(
        doc.uri,
        "恢复配置后 error 回来",
        (list) => list.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        20000,
      );
    });
  } finally {
    report();
  }
}

/** 汇总结果，失败则抛出。 */
function report() {
  const failed = results.filter((r) => !r.ok);
  const total = results.length;
  console.log("");
  console.log(`[e2e] 用例：${total - failed.length}/${total} 通过`);
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} (${r.ms}ms)`);
  }

  // 报告写入文件，便于 CI 抓取
  const reportFile = process.env.BDL_E2E_REPORT;
  if (reportFile) {
    const payload = results.map((r) => ({
      name: r.name,
      ok: r.ok,
      ms: r.ms,
      error: r.error ? String(r.error.stack ?? r.error) : undefined,
    }));
    fs.writeFileSync(reportFile, JSON.stringify(payload, null, 2), "utf8");
  }

  if (failed.length > 0) {
    throw new Error(`${failed.length} 个用例失败：${failed.map((f) => f.name).join(", ")}`);
  }
}

module.exports = { run };
