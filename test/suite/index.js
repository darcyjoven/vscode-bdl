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

    // 4. 扩展名 → 语言 id 的映射
    //
    // 这条曾经出过问题：用户报「.4gl 没被识别，但 .per 被识别了」。
    // 实测插件声明是对的，但既然出过一次疑云，就用测试钉死，
    // 以后再有人改动 contributes.languages 会立刻红。
    await test("扩展名映射：.4gl/.global→bdl，.per→per", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");

      const cases = [
        ["probe-a.4gl", "bdl"],
        ["probe-b.global", "bdl"],
        ["probe-c.per", "per"],
        // 大小写不敏感：Windows 上文件名常被写成大写
        ["probe-d.4GL", "bdl"],
        ["probe-e.GLOBAL", "bdl"],
        ["probe-f.PER", "per"],
      ];

      for (const [name, want] of cases) {
        const file = path.join(root, name);
        fs.writeFileSync(file, "MAIN\nEND MAIN\n");
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        assert.strictEqual(
          doc.languageId,
          want,
          `${name} 识别为 ${doc.languageId}，期望 ${want}`,
        );
      }
    });

    // 5. 语言配置可用（行注释 / 块注释 / 缩进）
    //
    // 曾经有 per.json 不是合法 JSON、bdl.json 用了 JS 不支持的 (?i)。
    // 这两种错误 VSCode 只 console.warn，功能静默失效，必须实测。
    await test("语言配置生效（注释与缩进）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;

      // 行注释：.4gl 应插入 --
      const bdl = path.join(root, "cfgbdl.4gl");
      fs.writeFileSync(bdl, "MAIN\nEND MAIN\n");
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(bdl));
      let ed = await vscode.window.showTextDocument(doc);
      ed.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand("editor.action.commentLine");
      assert.ok(
        doc.getText().startsWith("-- MAIN"),
        `.4gl 行注释不正确：${JSON.stringify(doc.lineAt(0).text)}`,
      );

      // 缩进：IF ... THEN 后回车应自动缩进
      const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      await ed.edit((b) => b.replace(full, "IF x THEN\nEND IF\n"));
      const line0End = doc.lineAt(0).range.end;
      ed.selection = new vscode.Selection(line0End, line0End);
      await vscode.commands.executeCommand("type", { text: "\n" });
      assert.ok(
        /^\s{2,}$/.test(doc.lineAt(1).text),
        `IF 后未自动缩进：${JSON.stringify(doc.lineAt(1).text)}`,
      );

      // 块注释：.4gl 用 { }
      const bdoc = path.join(root, "cfgblock.4gl");
      fs.writeFileSync(bdoc, "MAIN\n");
      const d2 = await vscode.workspace.openTextDocument(vscode.Uri.file(bdoc));
      ed = await vscode.window.showTextDocument(d2);
      ed.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand("editor.action.blockComment");
      assert.ok(
        d2.getText().includes("{") && d2.getText().includes("}"),
        `.4gl 块注释未使用 { }：${JSON.stringify(d2.getText())}`,
      );

      // .per 行注释
      const per = path.join(root, "cfg.per");
      fs.writeFileSync(per, "SCHEMA ds\n");
      const d3 = await vscode.workspace.openTextDocument(vscode.Uri.file(per));
      ed = await vscode.window.showTextDocument(d3);
      ed.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand("editor.action.commentLine");
      assert.ok(
        d3.getText().startsWith("-- SCHEMA"),
        `.per 行注释不正确：${JSON.stringify(d3.lineAt(0).text)}`,
      );
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

    // 15. GLOBALS 跳转：引用方 4gl 里的全局变量跳到 .global 文件内定义
    //     （P3a 用户明确要求的能力；工作区 fixtures 同目录可互相解析）
    await test("GLOBALS 变量跳转到 global 文件", async () => {
      const doc = await openFixture("globals_main.4gl");
      const lines = doc.getText().split("\n");
      const useLine = lines.findIndex((l) => /g_counter/i.test(l));
      assert.ok(useLine >= 0, "fixture 里找不到 g_counter");
      const col = doc.lineAt(useLine).text.toLowerCase().indexOf("g_counter");

      const defs = await vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        doc.uri,
        new vscode.Position(useLine, col + 2),
      );
      assert.ok(Array.isArray(defs) && defs.length > 0, "GLOBALS 变量没有跳转结果");

      const def = defs[0];
      assert.strictEqual(
        def.uri.toString().toLowerCase().endsWith("globals_defs.global"),
        true,
        `跳转目标应在 .global 文件里，实际 ${def.uri}`,
      );
    });

    // 16. GLOBALS 文件缺失产生警告（P3a F3）
    await test("GLOBALS 文件未找到产生警告", async () => {
      const doc = await openFixture("globals_missing.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "globals_missing.4gl 出现 globals-file-not-found 警告",
        (list) =>
          list.some((d) => d.code !== undefined && String(d.code).includes("globals-file-not-found")),
      );
      const warn = all.find(
        (d) => d.code !== undefined && String(d.code).includes("globals-file-not-found"),
      );
      assert.strictEqual(
        warn.severity,
        vscode.DiagnosticSeverity.Warning,
        `级别应为 warning，实际 ${warn.severity}`,
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
