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

    // 17. 字段不在表单中产生警告（P3b；fixtures 同目录可互相解析）
    await test("字段不存在于表单产生警告", async () => {
      const doc = await openFixture("field_main.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "field_main.4gl 出现 field-not-in-form 警告",
        (list) =>
          list.some((d) => d.code !== undefined && String(d.code).includes("field-not-in-form")),
      );
      const warn = all.find(
        (d) => d.code !== undefined && String(d.code).includes("field-not-in-form"),
      );
      assert.strictEqual(
        warn.severity,
        vscode.DiagnosticSeverity.Warning,
        `级别应为 warning，实际 ${warn.severity}`,
      );
      assert.ok(
        warn.message.includes("bad_field"),
        `消息应含 bad_field：${warn.message}`,
      );
    });

    // 18. 存在的字段不告警（防误报）
    await test("存在的表单字段不产生警告", async () => {
      const doc = await openFixture("field_main.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "field_main.4gl 诊断稳定",
        (list) => list.length > 0,
      );
      const fieldDiags = all.filter(
        (d) => d.code !== undefined && String(d.code).includes("field-not-in-form"),
      );
      const badField = fieldDiags.some((d) => d.message.includes("bad_field"));
      const goodField = fieldDiags.some((d) => d.message.includes("good_field"));
      assert.ok(badField, "bad_field 应被报告");
      assert.ok(!goodField, "good_field 不应被报告（防误报）");
    });

    // 19. 格式化：关键字转大写 + 缩进归一（P4）
    await test("格式化关键字转大写并归一缩进", async () => {
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "format.keywords",
        "upper",
        vscode.ConfigurationTarget.Global,
      );
      await cfg.update(
        "format.indentStyle",
        "space",
        vscode.ConfigurationTarget.Global,
      );
      await cfg.update("format.indentSize", 3, vscode.ConfigurationTarget.Global);

      try {
        const doc = await openFixture("fmt_messy.4gl");
        const text = doc.getText();
        assert.ok(/^\s*define /m.test(text), "fixture 应是全小写关键字");

        const edits = await vscode.commands.executeCommand(
          "vscode.executeFormatDocumentProvider",
          doc.uri,
          { tabSize: 3, insertSpaces: true },
        );
        assert.ok(Array.isArray(edits) && edits.length > 0, "格式化没有返回编辑");

        const ws = new vscode.WorkspaceEdit();
        ws.set(doc.uri, edits);
        await vscode.workspace.applyEdit(ws);

        const out = doc.getText();
        assert.ok(/\bMAIN\b/.test(out), "MAIN 应大写");
        assert.ok(/\bEND MAIN\b/.test(out), "END MAIN 应大写");
        assert.ok(/\bDEFINE\b/.test(out), "DEFINE 应大写");
        assert.ok(!/^\s*define /m.test(out), "仍有小写 define");

        // 缩进：MAIN 体内应为 3 空格
        const lines = out.split("\n");
        const mainIdx = lines.findIndex((l) => /^\s*MAIN\s*$/.test(l));
        assert.ok(mainIdx >= 0, "找不到 MAIN 行");
        const bodyIdx = mainIdx + 1;
        assert.ok(
          lines[bodyIdx].startsWith("   ") && !lines[bodyIdx].startsWith("    "),
          `MAIN 体缩进应为 3 空格，实际 ${JSON.stringify(lines[bodyIdx])}`,
        );

        // 记录体只应多缩进一级（同一行多块回归）
        const recIdx = lines.findIndex((l) => /RECORD\s*$/.test(l));
        assert.ok(recIdx >= 0, "找不到 RECORD 行");
        const recBody = lines[recIdx + 1];
        assert.ok(
          recBody.startsWith("      ") && !recBody.startsWith("         "),
          `记录体应为 6 空格，实际 ${JSON.stringify(recBody)}`,
        );

        // 幂等：再格式化一次不应再有编辑
        const edits2 = await vscode.commands.executeCommand(
          "vscode.executeFormatDocumentProvider",
          doc.uri,
          { tabSize: 3, insertSpaces: true },
        );
        assert.strictEqual(
          Array.isArray(edits2) ? edits2.length : 0,
          0,
          "第二次格式化仍返回编辑（不幂等）",
        );
      } finally {
        await cfg.update("format.keywords", undefined, vscode.ConfigurationTarget.Global);
        await cfg.update(
          "format.indentStyle",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
        await cfg.update("format.indentSize", undefined, vscode.ConfigurationTarget.Global);
      }
    });

    // 20. .per 不做任何格式化（用户明确要求）
    await test("per 文件拒绝格式化", async () => {
      const doc = await openFixture("sample.per");
      const edits = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider",
        doc.uri,
        { tabSize: 4, insertSpaces: true },
      );
      assert.ok(
        !Array.isArray(edits) || edits.length === 0,
        `.per 不应返回格式化编辑，实际 ${JSON.stringify(edits)}`,
      );
    });

    // 21. 部署命令已注册（P5）
    await test("部署命令已注册", async () => {
      const all = await vscode.commands.getCommands(true);
      for (const name of [
        "bdl.deploy",
        "bdl.deployCurrentFile",
        "bdl.deployDryRun",
        "bdl.deployListTargets",
      ]) {
        assert.ok(all.includes(name), `缺少命令 ${name}`);
      }
    });

    // 22. 部署预演：无配置时应给出可读错误而不是崩溃
    await test("无部署配置时给出错误", async () => {
      // 不抛异常即为通过：命令内部会用 showErrorMessage 提示。
      await vscode.commands.executeCommand("bdl.deployDryRun");
      assert.ok(true);
    });

    // 23. 有配置时预演成功（含 include/exclude 与编译计划）
    await test("部署预演列出计划", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const { execFileSync } = require("node:child_process");
      // 二进制路径由 runTest.js 通过 BDL_LSP_PATH 传入（与语言客户端同源），
      // 避免在测试里猜相对路径。
      const binary = process.env.BDL_LSP_PATH;
      assert.ok(binary && fs.existsSync(binary), `找不到 bdl-lsp: ${binary}`);

      // 在工作区里放一份配置：远程地址随便写，dry-run 不连接。
      const cfgDir = path.join(root, ".bdl-lsp");
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(
        path.join(cfgDir, "deploy.json"),
        JSON.stringify(
          {
            targets: {
              e2e: {
                host: "127.0.0.1",
                user: "nobody",
                remoteRoot: "/tmp/bdl-e2e-deploy",
                upload: { include: ["**/*.4gl", "**/*.per"] },
                compile: { "4gl": "fglcomp -M {file}" },
              },
            },
            defaultTarget: "e2e",
          },
          null,
          2,
        ),
        "utf8",
      );

      const out = execFileSync(
        binary,
        ["deploy", "-workspace", root, "-dry-run", "-json"],
        { encoding: "utf8" },
      );
      const res = JSON.parse(out);
      assert.strictEqual(res.ok, true, "预演应成功");
      assert.ok(res.files > 0, `预演应列出文件，实际 ${res.files}`);
      const logs = (res.logs || []).join("\n");
      assert.ok(logs.includes("upload"), `日志应含上传计划：${logs}`);
      assert.ok(logs.includes("compile"), `日志应含编译计划：${logs}`);

      fs.rmSync(cfgDir, { recursive: true, force: true });
    });

    // 24. 补全：空前缀给出关键字（P6）
    await test("补全给出关键字", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      // 找 MAIN 行，在它下一行的行首触发补全（空前缀）
      const mainIdx = lines.findIndex((l) => /^MAIN\s*$/.test(l));
      assert.ok(mainIdx >= 0, "找不到 MAIN 行");

      const list = await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(mainIdx + 1, 4),
      );
      assert.ok(list && Array.isArray(list.items), "补全未返回 items");
      assert.ok(list.items.length > 0, "补全为空");
      const labels = list.items.map((i) =>
        typeof i.label === "string" ? i.label : i.label.label,
      );
      assert.ok(
        labels.some((l) => l === "DISPLAY" || l === "END"),
        `应有 BDL 关键字，实际前几项 ${labels.slice(0, 10).join(", ")}`,
      );
    });

    // 25. 补全：前缀过滤 + 同文件函数
    await test("补全包含同文件函数", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      // 找到 CALL show_name 之前的空位，输入 show 触发
      const callIdx = lines.findIndex((l) => /^\s*CALL\s+show_name/i.test(l));
      assert.ok(callIdx >= 0, "找不到 CALL show_name 行");
      const col = doc.lineAt(callIdx).text.toLowerCase().indexOf("call") + 5;

      const list = await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(callIdx, col),
        "sh",
      );
      assert.ok(list && Array.isArray(list.items), "补全未返回 items");
      const labels = list.items.map((i) =>
        typeof i.label === "string" ? i.label : i.label.label,
      );
      assert.ok(
        labels.some((l) => l.toLowerCase() === "show_name"),
        `应含同文件函数 show_name，实际 ${labels.slice(0, 10).join(", ")}`,
      );
    });

    // 26. 重命名：函数定义与调用一起改（P6）
    await test("重命名函数同时改调用", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      const defIdx = lines.findIndex((l) => /^\s*FUNCTION\s+show_name/i.test(l));
      assert.ok(defIdx >= 0, "找不到 FUNCTION show_name 行");
      const col = doc.lineAt(defIdx).text.toLowerCase().indexOf("show_name") + 2;

      const edit = await vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        doc.uri,
        new vscode.Position(defIdx, col),
        "display_name",
      );
      assert.ok(edit && edit.size > 0, "重命名未返回编辑");

      const entries = edit.entries();
      assert.ok(entries.length > 0, "编辑为空");
      const [, edits] = entries[0];
      assert.ok(edits.length >= 2, `应改定义与调用共 >=2 处，实际 ${edits.length}`);
      for (const e of edits) {
        assert.strictEqual(e.newText, "display_name", "newText 不符");
      }
    });

    // 27. 重命名拒绝关键字（prepareRename 阶段就拦住）
    await test("重命名拒绝关键字", async () => {
      const doc = await openFixture("sample.4gl");
      const lines = doc.getText().split("\n");
      const mainIdx = lines.findIndex((l) => /^MAIN\s*$/.test(l));
      assert.ok(mainIdx >= 0, "找不到 MAIN");

      let failed = false;
      try {
        await vscode.commands.executeCommand(
          "vscode.executeDocumentRenameProvider",
          doc.uri,
          new vscode.Position(mainIdx, 1),
          "IF",
        );
      } catch {
        failed = true;
      }
      // MAIN 是关键字，prepareRename 应拒绝（抛错或返回空）
      assert.ok(failed, "对关键字改名应失败");
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
