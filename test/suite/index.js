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
      for (const id of [
        "bdl.restartServer",
        "bdl.showServerInfo",
        // 清理项 C5：bdl.showOutput 已并入「显示语言服务器信息」
        // P7-E：链接资料视图的刷新与反查
        "bdl.links.refresh",
        "bdl.links.references",
        // P0-3：文件因上限/超时没被解析时的"强制解析当前文件"
        "bdl.forceParseCurrentFile",
        // P2-1：数据库字段视图与命令（含勾选多表批量同步）
        "bdl.schema.syncAll",
        "bdl.schema.syncSelected",
        "bdl.schema.selectAll",
        "bdl.schema.clearSelection",
        "bdl.schema.refresh",
        "bdl.schema.filter",
        "bdl.schema.import",
        "bdl.schema.syncTable",
        "bdl.schema.copyColumn",
        // P1-1：链接资料的采集/导入/状态命令（调用 tiptop）
        "bdl.link.importCsv",
        "bdl.link.syncModules",
        "bdl.link.syncAll",
        "bdl.link.status",
        // W3：链接资料视图的「从数据库更新」
        "bdl.link.updateFromDb",
        // W5：本地编译/链接/预览（4GL 与 Form 各三种）
        "bdl.build.4gl.preview",
        "bdl.build.4gl.compile",
        "bdl.build.4gl.link",
        "bdl.build.per.preview",
        "bdl.build.per.compile",
        "bdl.build.per.form",
        // W6：把旧布局（.link/、.project 根、.project/.schema）搬到 .project/{link,schema,deploy}/
        "bdl.migrateLinkDir",
      ]) {
        assert.ok(commands.includes(id), `缺少命令 ${id}`);
      }
      // 清理项 C1/C2/C5：这些命令已删除（合并到单一入口）
      for (const gone of [
        "bdl.showOutput",
        "bdl.link.syncCurrent",
        "bdl.links.resync",
        "bdl.schema.syncFiltered",
      ]) {
        assert.ok(!commands.includes(gone), `${gone} 应已删除（清理项 C1/C2/C5）`);
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

    // 7. 语法错误文件出现波浪线
    //
    // 级别是 warning 不是 error：Q10（P7-B）定稿"全部诊断默认 warning"，
    // 语法错误也一样——它只是"可能有问题"，不该在 Problems 里冒充红叉。
    // 这里断言的是"有诊断 + 码正确"，级别单列一条，改默认值时只改一处。
    await test("语法错误产生 warning 诊断", async () => {
      const doc = await openFixture("broken.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "broken.4gl 出现语法诊断",
        (list) => list.some((d) => d.code === "syntax-error"),
      );
      const errors = all.filter((d) => d.code === "syntax-error");
      assert.ok(errors.length > 0, "没有 syntax-error 诊断");
      assert.ok(
        errors.every((d) => d.severity === vscode.DiagnosticSeverity.Warning),
        `语法诊断默认应为 warning，实际 ${errors.map((d) => d.severity).join(",")}`,
      );
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
        (list) => list.some((d) => d.code === "syntax-error"),
        40000,
      );
    });

    // 14. 配置变更即时生效：关掉语法诊断后 error 消失
    await test("配置热更新生效", async () => {
      const doc = await openFixture("broken.4gl");
      await waitForDiagnostics(
        doc.uri,
        "配置改动前有语法诊断",
        (list) => list.some((d) => d.code === "syntax-error"),
      );

      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "diagnostics",
        { "syntax-error": "off" },
        vscode.ConfigurationTarget.Global,
      );

      await waitForDiagnostics(
        doc.uri,
        "diagnostics.syntax-error=off 后语法诊断消失",
        (list) => !list.some((d) => d.code === "syntax-error"),
        20000,
      );

      // 还原
      await cfg.update(
        "diagnostics",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await waitForDiagnostics(
        doc.uri,
        "恢复配置后语法诊断回来",
        (list) => list.some((d) => d.code === "syntax-error"),
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
      // §0d：整包部署与「列出部署目标」已删除（只允许单文件上传、单目标）。
      assert.ok(!all.includes("bdl.deploy"), "整包部署命令应已删除");
      assert.ok(!all.includes("bdl.deployListTargets"), "列出部署目标命令应已删除");
      for (const name of ["bdl.deployCurrentFile", "bdl.deployDryRun"]) {
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
      // 部署已从 bdl-lsp 分离到 tiptop：路径由 runTest.js 通过 TIPTOP_PATH
      // 传入，避免在测试里猜相对路径。
      const binary = process.env.TIPTOP_PATH;
      assert.ok(binary && fs.existsSync(binary), `找不到 tiptop: ${binary}`);

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

    // 28. Code Action：字段拼错时给出"改为 good_field"的快速修复（P6）
    await test("字段拼错提供快速修复", async () => {
      const doc = await openFixture("field_main.4gl");
      // 等字段诊断出现
      const all = await waitForDiagnostics(
        doc.uri,
        "field_main.4gl 出现 field-not-in-form",
        (list) =>
          list.some(
            (d) => d.code !== undefined && String(d.code).includes("field-not-in-form"),
          ),
      );
      const diag = all.find(
        (d) => d.code !== undefined && String(d.code).includes("field-not-in-form"),
      );
      assert.ok(diag, "找不到 field-not-in-form 诊断");
      assert.ok(diag.message.includes("bad_field"), `消息应含 bad_field：${diag.message}`);

      // 把诊断原样传回服务器请求 code action
      const actions = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        doc.uri,
        diag.range,
        "quickfix", // 命令参数要字符串，不是 CodeActionKind 对象
      );
      assert.ok(Array.isArray(actions), "code action 未返回数组");
      const fixes = actions.filter(
        (a) => a.edit && a.edit.size > 0,
      );
      assert.ok(fixes.length > 0, `应有带编辑的快速修复，实际 ${actions.length} 个动作`);

      // 至少一个修复会把 bad_field 改成 good_field
      let found = false;
      for (const a of fixes) {
        for (const [, edits] of a.edit.entries()) {
          for (const e of edits) {
            if (e.newText === "good_field") {
              found = true;
            }
          }
        }
      }
      assert.ok(found, `应有改为 good_field 的修复，实际 ${fixes.map((a) => a.title).join(" / ")}`);
    });

    // 29. Code Action：没有诊断时不返回动作（不刷无意义项）
    await test("无诊断时无快速修复", async () => {
      const doc = await openFixture("sample.4gl");
      const actions = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        doc.uri,
        new vscode.Range(0, 0, 0, 5),
        "quickfix",
      );
      const withEdit = (actions || []).filter((a) => a.edit && a.edit.size > 0);
      assert.strictEqual(withEdit.length, 0, "不该有带编辑的动作");
    });

    // 30. 语义高亮：用户自定义符号有 token，关键字没有（交给 TextMate）（P6）
    await test("语义高亮标注自定义符号", async () => {
      const doc = await openFixture("sample.4gl");
      const legend = await vscode.commands.executeCommand(
        "vscode.provideDocumentSemanticTokensLegend",
        doc.uri,
      );
      assert.ok(legend && Array.isArray(legend.tokenTypes), "语义高亮 legend 缺失");
      assert.ok(legend.tokenTypes.includes("function"), "legend 应含 function");
      assert.ok(legend.tokenTypes.includes("variable"), "legend 应含 variable");

      const tokens = await vscode.commands.executeCommand(
        "vscode.provideDocumentSemanticTokens",
        doc.uri,
      );
      assert.ok(tokens !== undefined, "语义 token 为空");

      // 解码：每 5 个数字一组（相对编码）
      const data = tokens.data;
      assert.ok(data.length > 0, "token 数据为空");
      assert.strictEqual(data.length % 5, 0, "token 数据长度必须是 5 的倍数");

      const funcIdx = legend.tokenTypes.indexOf("function");
      let hasFunction = false;
      let line = 0;
      for (let i = 0; i + 4 < data.length; i += 5) {
        if (data[i] > 0) {
          line += data[i];
        }
        if (data[i + 3] === funcIdx) {
          hasFunction = true;
          break;
        }
      }
      assert.ok(hasFunction, "应至少有一个 function token（show_name/r_list）");
    });

    // 31. 语义高亮不发关键字 token（避免与 TextMate 抢同一批 token）
    await test("语义高亮不重复关键字", async () => {
      const doc = await openFixture("sample.4gl");
      const legend = await vscode.commands.executeCommand(
        "vscode.provideDocumentSemanticTokensLegend",
        doc.uri,
      );
      const tokens = await vscode.commands.executeCommand(
        "vscode.provideDocumentSemanticTokens",
        doc.uri,
      );
      const keywordIdx = legend.tokenTypes.indexOf("keyword");
      if (keywordIdx < 0) {
        return; // legend 里没有 keyword，自然不发
      }
      const data = tokens.data;
      let keywordCount = 0;
      for (let i = 0; i + 4 < data.length; i += 5) {
        if (data[i + 3] === keywordIdx) {
          keywordCount++;
        }
      }
      assert.strictEqual(keywordCount, 0, `不该发 keyword token，实际 ${keywordCount} 个`);
    });

    // 32. record 成员校验默认关闭（P6）
    await test("record 成员校验默认关闭", async () => {
      const doc = await openFixture("record_member.4gl");
      const all = await waitForDiagnostics(
        doc.uri,
        "record_member.4gl 诊断稳定",
        (list) => list.length >= 0,
        3000,
      );
      const recDiags = (all || []).filter(
        (d) => d.code !== undefined && String(d.code).includes("record-member-unknown"),
      );
      assert.strictEqual(
        recDiags.length,
        0,
        `默认 off 时不该报 record-member-unknown，实际 ${recDiags.length} 条`,
      );
    });

    // 33. 开启后报出不存在的记录成员
    await test("record 成员校验开启后报错", async () => {
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "diagnostics",
        { "record-member-unknown": "warning" },
        vscode.ConfigurationTarget.Global,
      );
      try {
        const doc = await openFixture("record_member.4gl");
        // 触发一次重新诊断（改配置后会重发，但保险起见再改一下文档）
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(doc.lineCount - 1, 0), "\n");
        await vscode.workspace.applyEdit(edit);

        const all = await waitForDiagnostics(
          doc.uri,
          "出现 record-member-unknown",
          (list) =>
            list.some(
              (d) =>
                d.code !== undefined &&
                String(d.code).includes("record-member-unknown"),
            ),
          15000,
        );
        const diag = all.find(
          (d) =>
            d.code !== undefined && String(d.code).includes("record-member-unknown"),
        );
        assert.ok(diag, "应有 record-member-unknown");
        assert.ok(
          diag.message.includes("bad_member"),
          `消息应含 bad_member：${diag.message}`,
        );
        // 存在的成员不该报
        const goodReported = all.some(
          (d) =>
            d.code !== undefined &&
            String(d.code).includes("record-member-unknown") &&
            d.message.includes("good_one"),
        );
        assert.ok(!goodReported, "good_one 存在，不该被报");
      } finally {
        await cfg.update(
          "diagnostics",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    });

    // 34. 设置界面分五组（P1-5），且默认是"轻量档"（P1-4）
    await test("设置项按三组分组且默认轻量", async () => {
      const pkg = require("../../package.json");
      const sections = pkg.contributes.configuration;
      assert.ok(Array.isArray(sections), "configuration 应为数组（分层设置）");
      const titles = sections.map((s) => s.title);
      // §0d：重构成 3 组（基本设置 / 账号、生产环境、配置 / 上传编译链接）
      for (const want of ["基本设置", "账号、生产环境、配置", "上传编译链接"]) {
        assert.ok(titles.includes(want), `缺少设置分组：${want}`);
      }
      assert.strictEqual(sections.length, 3, `应只有 3 组，实际 ${sections.length}`);
      // 三层里都必须有各自的键，且不重复
      const seen = new Set();
      for (const sec of sections) {
        for (const key of Object.keys(sec.properties)) {
          assert.ok(!seen.has(key), `设置项重复：${key}`);
          seen.add(key);
        }
      }
      const all = Object.assign(
        {},
        ...sections.map((sec) => sec.properties),
      );
      // §0d：link/schema 从 enable 布尔变三态 mode；上传/编译各有总开关
      assert.strictEqual(all["bdl.link.mode"].default, "off", "link.mode 默认 off");
      assert.strictEqual(all["bdl.schema.mode"].default, "off", "schema.mode 默认 off");
      assert.strictEqual(all["bdl.deploy.enable"].default, false, "deploy.enable 默认 false");
      assert.strictEqual(all["bdl.build.enable"].default, false, "build.enable 默认 false");
      assert.strictEqual(
        all["bdl.prod.deploy.transport"].default,
        "off",
        "transport 默认 off（不上传）",
      );
      // 旧键已从清单移除（代码仍兼容读取）
      assert.ok(!all["bdl.link.enable"], "旧的 bdl.link.enable 应已从清单移除");
      assert.ok(!all["bdl.schema.enable"], "旧的 bdl.schema.enable 应已从清单移除");
      assert.ok(!all["bdl.deploy.target"], "bdl.deploy.target 应已删除");
      assert.ok(
        !all["bdl.prod.deploy.include"] && !all["bdl.prod.deploy.compile4gl"],
        "批量上传相关键应已删除",
      );
      assert.ok(all["bdl.prod.oracle.service"], "缺少 bdl.prod.oracle.service");
      assert.ok(all["bdl.prod.deploy.host"], "缺少 bdl.prod.deploy.host");
      assert.ok(all["bdl.build.4gl.link.command"], "缺少 bdl.build.4gl.link.command");
      // 清理项 C10：去掉 6 个 per-command enable，只留 build.enable 总开关
      assert.ok(!all["bdl.build.4gl.link.enable"], "bdl.build.4gl.link.enable 应已删除（C10）");
      assert.strictEqual(all["bdl.build.enable"].default, false, "build.enable 默认 false");
      // 运行时的实际取值也必须一致（代码里显式传默认值的地方别写反）
      const cfg = vscode.workspace.getConfiguration("bdl");
      assert.strictEqual(cfg.get("deploy.enable"), false, "deploy.enable 实际值应为 false");
      assert.strictEqual(cfg.get("build.enable"), false, "build.enable 实际值应为 false");
      assert.ok(all["bdl.schema.dataDir"], "缺少 bdl.schema.dataDir");
    });

    // 34a2. 轻量档的硬约束：不往项目里写文件
    await test("轻量档不往项目里写文件（P1-4）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      assert.ok(
        !fs.existsSync(path.join(root, ".project")),
        "默认（轻量档）不该创建 .project/",
      );
    });

    // 34a3. 部署配置由设置合成（P1-5）
    await test("部署配置由设置合成（P1-5）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(api.ensureDeployConfig, "应导出 ensureDeployConfig");

      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update("prod.deploy.host", "127.0.0.1", vscode.ConfigurationTarget.Global);
      await cfg.update("prod.deploy.user", "e2e", vscode.ConfigurationTarget.Global);
      await cfg.update("prod.deploy.remoteRoot", "/tmp/e2e", vscode.ConfigurationTarget.Global);
      await cfg.update("prod.deploy.transport", "rsync", vscode.ConfigurationTarget.Global);
      const dest = path.join(root, ".project", "deploy", "deploy.json");
      try {
        const res = await api.ensureDeployConfig(root, "test");
        assert.ok(res.path === dest, `合成的路径应为 ${dest}，实际 ${res.path}`);
        const doc = JSON.parse(fs.readFileSync(dest, "utf8"));
        assert.ok(
          String(doc.createdBy).startsWith("vscode-bdl"),
          `createdBy 应标明插件来源：${doc.createdBy}`,
        );
        assert.strictEqual(doc.defaultTarget, "prod");
        const t = doc.targets.prod;
        assert.ok(t, "应生成 prod 目标");
        assert.strictEqual(t.host, "127.0.0.1");
        assert.strictEqual(t.user, "e2e");
        assert.strictEqual(t.remoteRoot, "/tmp/e2e");
        assert.strictEqual(t.upload.mode, "rsync");
        assert.strictEqual(t.upload.fallback, "scp");
        // §0d：不再生成批量上传与编译命令
        assert.ok(!t.upload.include && !t.upload.delete, "不应再有 include/delete");
        assert.ok(!t.compile, "不应再有 compile（编译命令由 tiptop exec 传入）");

        // scp 模式：fallback 必须是 none（tiptop 校验不接受与 mode 相同的回退）
        await cfg.update("prod.deploy.transport", "scp", vscode.ConfigurationTarget.Global);
        const resScp = await api.ensureDeployConfig(root, "test");
        const docScp = JSON.parse(fs.readFileSync(resScp.path, "utf8"));
        assert.strictEqual(docScp.targets.prod.upload.mode, "scp");
        assert.strictEqual(docScp.targets.prod.upload.fallback, "none");
        await cfg.update("prod.deploy.transport", "rsync", vscode.ConfigurationTarget.Global);

        // 不是插件生成的文件（没有 createdBy）在覆盖前要备份
        fs.writeFileSync(dest, JSON.stringify({ targets: { hand: {} } }));
        const res2 = await api.ensureDeployConfig(root, "test");
        assert.ok(res2.backup, "手写文件应被备份");
        assert.ok(fs.existsSync(res2.backup), `备份文件应存在：${res2.backup}`);

        // 缺必填项时要给出"缺什么"，而不是含糊失败
        await cfg.update("prod.deploy.host", "", vscode.ConfigurationTarget.Global);
        const res3 = await api.ensureDeployConfig(root, "test");
        assert.ok(!res3.path && res3.error, "缺设置时应返回错误");
        assert.ok((res3.missing ?? []).length > 0, "应列出缺哪些设置项");

        // 上传方式为 off 时拒绝合成
        await cfg.update("prod.deploy.host", "127.0.0.1", vscode.ConfigurationTarget.Global);
        await cfg.update("prod.deploy.transport", "off", vscode.ConfigurationTarget.Global);
        const res4 = await api.ensureDeployConfig(root, "test");
        assert.ok(!res4.path && res4.error, "transport=off 时应拒绝合成");
      } finally {
        fs.rmSync(path.join(root, ".project"), { recursive: true, force: true });
        for (const key of ["prod.deploy.host", "prod.deploy.user", "prod.deploy.remoteRoot", "prod.deploy.transport"]) {
          await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    });

    // 34b. P1-1：链接资料命令的影响面解析 + 总开关关闭时行为
    await test("链接资料命令：影响面解析（P1-1）", async () => {
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      assert.ok(ext, "找不到扩展");
      const api = await ext.activate();
      assert.ok(api, "activate 应返回 API 对象");
      assert.deepStrictEqual(
        api.parseAffectedJobs(
          "文件条件        aap/4gl/saapt310.4gl\n受影响作业      2 个（PROG1, PROG2）\n",
        ),
        { count: 2, names: "PROG1, PROG2" },
        "应解析出受影响作业数",
      );
      assert.strictEqual(
        api.parseAffectedJobs("没有这一行"),
        undefined,
        "解析不出来时应返回 undefined（调用方退化成让用户看输出）",
      );
      // 0 个作业也能解析出来（调用方据此提示"没有匹配"）
      assert.deepStrictEqual(
        api.parseAffectedJobs("受影响作业      0 个"),
        { count: 0, names: "" },
        "0 个作业应能解析",
      );
    });

    // 34c. 关闭链接总开关：链接命令仍注册、执行不抛错（面板按 when 隐藏）
    await test("link.enable=false 时链接命令不报错", async () => {
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "link.mode",
        "off",
        vscode.ConfigurationTarget.Global,
      );
      try {
        await new Promise((r) => setTimeout(r, 300));
        const commands = await vscode.commands.getCommands(true);
        for (const id of ["bdl.link.status", "bdl.link.updateFromDb"]) {
          assert.ok(commands.includes(id), `命令应仍然注册：${id}`);
        }
        // 没有 tiptop 二进制 / 没有工作区时也不该抛错（内部只提示）
        await vscode.commands.executeCommand("bdl.link.status");
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        await cfg.update(
          "link.mode",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    });

    // 35. 关闭部署总开关：命令面板隐藏部署命令
    await test("deploy.enable=false 时隐藏部署命令", async () => {
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "deploy.enable",
        false,
        vscode.ConfigurationTarget.Global,
      );
      try {
        await new Promise((r) => setTimeout(r, 300));
        // 命令本身仍然注册（直接调用会提示"已关闭"），
        // 但命令面板按 when 条件隐藏。
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
          commands.includes("bdl.deployCurrentFile"),
          "命令应仍然注册，只是面板隐藏",
        );
        // 执行不应抛错（内部提示已关闭）
        await vscode.commands.executeCommand("bdl.deployCurrentFile");
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        await cfg.update(
          "deploy.enable",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    });

    // 36. GLOBALS 索引不串味：同时打开多个文档时，
    //     一个文档不能借用另一个文档的 GLOBALS 导入。
    await test("GLOBALS 索引不跨文档串味", async () => {
      // globals_main.4gl 引用 globals_defs.global（定义 g_counter）
      const main = await openFixture("globals_main.4gl");
      await waitForDiagnostics(
        main.uri,
        "globals_main.4gl 完成首轮诊断",
        () => true,
        20000,
      );

      // globals_other.4gl：**不引用**任何 .global，却用了 g_counter。
      // 它应报 variable-source-unresolved —— 不能因为 main.4gl 开着
      // 就借用 main.4gl 的导入（0.3.1 修的串味问题）。
      const other = await openFixture("globals_unrelated.4gl");
      const all = await waitForDiagnostics(
        other.uri,
        "globals_unrelated.4gl 报 variable-source-unresolved",
        (list) =>
          list.some(
            (d) =>
              d.code !== undefined &&
              String(d.code).includes("variable-source-unresolved"),
          ),
        20000,
      );
      assert.ok(
        all.some(
          (d) =>
            d.code !== undefined &&
            String(d.code).includes("variable-source-unresolved"),
        ),
        "未引入 .global 的文档不应借用别的文档的 GLOBALS 符号",
      );
    });

    // 37. 两个文档都引用同一个 .global 时，悬停的"来源"只列一次。
    //     用户报的现象："一个字段来源于某个 globals 文件，且都是同一个文件"
    //     ——即悬停里出现两条一模一样的 "xxx.global:2"。
    await test("同一 .global 被多文档引用时来源不重复", async () => {
      const other = await openFixture("globals_other.4gl");
      const lines = other.getText().split("\n");
      const useLine = lines.findIndex((l) => /g_counter/i.test(l));
      assert.ok(useLine >= 0, "fixture 里找不到 g_counter");
      const col = other.lineAt(useLine).text.toLowerCase().indexOf("g_counter");

      const hover = await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        other.uri,
        new vscode.Position(useLine, col + 2),
      );
      assert.ok(Array.isArray(hover) && hover.length > 0, "悬停没有结果");

      // 把所有悬停内容拼起来，数 "globals_defs.global" 出现几次
      let text = "";
      for (const h of hover) {
        for (const c of h.contents ?? []) {
          text += typeof c === "string" ? c : (c.value ?? "");
        }
      }
      assert.ok(text.includes("globals_defs.global"), `悬停应写出来源文件：${text}`);

      const count = text.split("globals_defs.global").length - 1;
      assert.strictEqual(
        count,
        1,
        `来源里应只出现 1 次 globals_defs.global，实际 ${count} 次：\n${text}`,
      );
    });

    // 38. 关闭链接资料总开关：视图不再请求服务器
    // 37b. P2-1：数据库字段端到端（写资料 → 开开关 → 请求 → 过滤 → 清掉）
    await test("数据库字段：端到端查询与正则过滤（P2-1）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(api.querySchemaTables, "应导出 querySchemaTables");

      writeSchemaFixture(root);

      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update("schema.mode", "db", vscode.ConfigurationTarget.Global);
      try {
        await new Promise((r) => setTimeout(r, 600)); // 等配置下发 + 服务端重载

        const all = await api.querySchemaTables("");
        assert.ok(all && all.present, `应有资料：${JSON.stringify(all)}`);
        assert.strictEqual(all.total, 2, "应有 2 张表");
        assert.strictEqual(all.enabled, true, "开关应已打开");

        const filtered = await api.querySchemaTables("^APA");
        assert.strictEqual(filtered.total, 2, "total 是表总数，不受过滤影响");
        assert.strictEqual(filtered.matched, 1, "^APA 应匹配 1 张");
        assert.strictEqual(
          (filtered.tables || [])[0].name,
          "apa_file",
          "匹配到的应是 apa_file",
        );

        const bad = await api.querySchemaTables("(ima");
        assert.ok(bad.filterError, "非法正则应给 filterError");
        assert.strictEqual(bad.matched, 2, "非法正则应退回全部");

        const cols = await api.querySchemaColumns("APA_FILE");
        assert.ok(cols && !cols.missing, `应有列：${JSON.stringify(cols)}`);
        assert.strictEqual(cols.columns.length, 2, "apa_file 应有 2 列");
        assert.strictEqual(cols.columns[0].name, "apa01");
        assert.strictEqual(cols.columns[0].desc, "物料编号");

        const missing = await api.querySchemaColumns("nosuch");
        assert.strictEqual(missing.missing, true, "不存在的表应 missing");

        // 视图命令不抛错
        await vscode.commands.executeCommand("bdl.schema.refresh");
        await vscode.commands.executeCommand("bdl.schema.clearFilter");
        await new Promise((r) => setTimeout(r, 200));

        // 关掉开关后：请求报 enabled=false（视图也被 when 隐藏）
        await cfg.update("schema.mode", "off", vscode.ConfigurationTarget.Global);
        await new Promise((r) => setTimeout(r, 600));
        const off = await api.querySchemaTables("");
        assert.strictEqual(off.enabled, false, "关掉后 enabled 应为 false");
        assert.ok(!off.present, "关掉后不应再持有资料");
      } finally {
        await cfg.update("schema.mode", undefined, vscode.ConfigurationTarget.Global);
        removeSchemaFixture(root);
        await new Promise((r) => setTimeout(r, 300));
      }
    });

    // 37c. P2-1 补：勾选一个或多个表批量同步（树视图原生不能多选，用复选框）
    // 回归：正则筛选走**视图路径**（曾因缓存 this.tables 导致"筛选没反应"）。
    await test("数据库字段：正则筛选（视图路径，大小写不敏感）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(api.schemaFilter, "应导出 schemaFilter（视图路径）");

      writeSchemaFixture(root);
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update("schema.mode", "db", vscode.ConfigurationTarget.Global);
      try {
        await new Promise((r) => setTimeout(r, 600)); // 等配置下发 + 服务端重载

        // 命令存在（命令面板入口）
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("bdl.schema.filter"), "缺少 bdl.schema.filter");
        assert.ok(commands.includes("bdl.schema.clearFilter"), "缺少 bdl.schema.clearFilter");

        // 大写正则
        assert.deepStrictEqual(
          await api.schemaFilter("^APA"),
          ["apa_file"],
          "^APA 应只剩 apa_file",
        );
        // 小写也要匹配（服务端 (?i)，用户习惯输小写表名）
        assert.deepStrictEqual(
          await api.schemaFilter("ima"),
          ["ima_file"],
          "小写 ima 也应匹配 ima_file（大小写不敏感）",
        );
        // 分组正则
        assert.deepStrictEqual(
          await api.schemaFilter("(ima|apa)_file"),
          ["apa_file", "ima_file"],
          "分组正则应匹配两张表",
        );
        // 非法正则：退回全部（不是"没有结果"）
        assert.deepStrictEqual(
          await api.schemaFilter("(ima"),
          ["apa_file", "ima_file"],
          "非法正则应退回全部",
        );
        // 无匹配
        assert.deepStrictEqual(await api.schemaFilter("NOSUCH"), [], "无匹配应为空");
        // 清空恢复
        assert.deepStrictEqual(
          await api.schemaFilter(""),
          ["apa_file", "ima_file"],
          "清空过滤应恢复全部",
        );
      } finally {
        await api.schemaFilter("");
        await cfg.update("schema.mode", undefined, vscode.ConfigurationTarget.Global);
        removeSchemaFixture(root);
        await new Promise((r) => setTimeout(r, 300));
      }
    });

    await test("数据库字段：勾选多张表批量同步（P2-1 补）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(api.schemaProvider, "应导出 schemaProvider");
      writeSchemaFixture(root);

      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update("schema.mode", "db", vscode.ConfigurationTarget.Global);
      try {
        await new Promise((r) => setTimeout(r, 600));
        const provider = api.schemaProvider;
        await provider.load();
        const listed = provider.listedTables().map((t) => t.toLowerCase());
        assert.deepStrictEqual(listed.sort(), ["apa_file", "ima_file"], `列出两张表：${listed}`);

        // 初始未勾选：表节点的 checkboxState 必须是 Unchecked（UI 上能看到复选框）
        let nodes = await provider.getChildren(undefined);
        let tableNode = nodes.find((n) => n.kind === "table" && n.name === "apa_file");
        assert.ok(tableNode, "应有 apa_file 节点");
        assert.strictEqual(
          provider.getTreeItem(tableNode).checkboxState,
          vscode.TreeItemCheckboxState.Unchecked,
          "未勾选时复选框应为 Unchecked",
        );

        // 全选当前列表 → 两张都勾上；节点渲染成 Checked
        await vscode.commands.executeCommand("bdl.schema.selectAll");
        assert.deepStrictEqual(
          provider.selectedTables(),
          ["apa_file", "ima_file"],
          `全选后应勾选两张：${provider.selectedTables()}`,
        );
        nodes = await provider.getChildren(undefined);
        tableNode = nodes.find((n) => n.kind === "table" && n.name === "apa_file");
        assert.strictEqual(
          provider.getTreeItem(tableNode).checkboxState,
          vscode.TreeItemCheckboxState.Checked,
          "勾选后复选框应为 Checked",
        );

        // 只勾一张时，批量同步命令应把这一张传给 -tables。
        // 注意：**不能 await** 会弹提示框的命令（没配库时会弹"打开设置"，
        // e2e 里无人点，await 会让扩展宿主一直挂着——这条踩过）。
        provider.selection.clear();
        provider.selection.add("apa_file");
        provider.refresh();
        fireAndForget("bdl.schema.syncSelected");
        await new Promise((r) => setTimeout(r, 400));

        // 清除勾选
        await vscode.commands.executeCommand("bdl.schema.clearSelection");
        assert.strictEqual(provider.selectedTables().length, 0, "清除后不应有勾选");

        // 预演统计解析（同步/导入共用同一份报告形状）
        const summary = api.parseSchemaSummary(
          "== schema 同步 ==\n来源            golang@db:1521/PROD owner=APP\n" +
            "CSV 行数        58096\n表              2648（新增 2648 / 变更 0 / 未变 0 / 保留 0）\n" +
            "列              58096\n",
        );
        assert.deepStrictEqual(
          summary,
          {
            rows: 58096,
            tables: 2648,
            added: 2648,
            changed: 0,
            same: 0,
            kept: 0,
            pruned: undefined,
          },
          `统计解析不对：${JSON.stringify(summary)}`,
        );
        const pruned = api.parseSchemaSummary("表              10（新增 1 / 变更 2 / 未变 3 / 保留 3 / 删除 1）");
        assert.strictEqual(pruned.pruned, 1, "应解析出删除数");

        // 进度行解析（CLI 与插件之间的协议；link 与 schema 共用）
        assert.deepStrictEqual(
          api.parseProgressLine("进度\t解析\tima_file\t12\t2648"),
          { phase: "解析", detail: "ima_file", done: 12, total: 2648 },
          "应解析出带计数的进度行",
        );
        assert.deepStrictEqual(
          api.parseProgressLine("进度\t采集\t连接 db:1521/PROD…"),
          { phase: "采集", detail: "连接 db:1521/PROD…" },
          "应解析出无计数的进度行",
        );
        assert.strictEqual(api.parseProgressLine("扫描源码 12/100"), undefined);
        assert.strictEqual(
          api.humanizeProgress({ phase: "解析", detail: "ima_file", done: 12, total: 2648 }),
          "解析表 ima_file（12/2648）",
          "进度文案要能看出卡在哪一步",
        );
        assert.strictEqual(
          api.humanizeProgress({ phase: "扫描源码", done: 400, total: 7600 }),
          "扫描源码 400/7600",
        );

        // C2：筛选后走「全选当前列表 + 同步已选中的表」（命令不抛错）
        fireAndForget("bdl.schema.selectAll");
        fireAndForget("bdl.schema.syncSelected");
        await new Promise((r) => setTimeout(r, 300));

        // 没配数据库时执行「从数据库同步」：只提示，不抛错（同样不能 await）
        fireAndForget("bdl.schema.syncAll");
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        await cfg.update("schema.mode", undefined, vscode.ConfigurationTarget.Global);
        removeSchemaFixture(root);
        await new Promise((r) => setTimeout(r, 300));
      }
    });

    await test("link.enable=false 时链接资料视图不发请求", async () => {
      const cfg = vscode.workspace.getConfiguration("bdl");
      await cfg.update(
        "link.mode",
        "off",
        vscode.ConfigurationTarget.Global,
      );
      try {
        await new Promise((r) => setTimeout(r, 300));
        // 刷新视图不应抛错；关闭时不发 bdl/linkTree 请求。
        await vscode.commands.executeCommand("bdl.links.refresh");
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        await cfg.update(
          "link.mode",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    });
    // W3/W4：按钮门控依据（数据库是否配置、是否已有全量资料）。
    await test("W3/W4：数据库/资料就绪状态（按钮显隐依据）", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(api.dbReadiness, "应导出 dbReadiness");

      const cfg = vscode.workspace.getConfiguration("bdl");
      const oracleKeys = [
        "prod.oracle.host",
        "prod.oracle.service",
        "prod.oracle.user",
      ];
      fs.rmSync(path.join(root, ".project"), { recursive: true, force: true });
      for (const key of oracleKeys) {
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
      try {
        let state = await api.dbReadiness();
        assert.strictEqual(state.configured, false, "未配 Oracle 时 configured 应为 false");
        assert.strictEqual(state.linkHasData, false, "没有 links.jsonl 时 linkHasData 应为 false");
        assert.strictEqual(state.schemaHasData, false, "没有 tables.json 时 schemaHasData 应为 false");
        // §0d：模式三态（默认 off）
        assert.strictEqual(state.linkMode, "off", "link.mode 默认应为 off");
        assert.strictEqual(state.schemaMode, "off", "schema.mode 默认应为 off");

        // 旧键 bdl.link.enable 已从清单移除（VSCode 不允许再写入未注册键）；
        // 兼容读取只对"老 settings.json 里已有的值"生效，这里只验证新键。
        assert.strictEqual(api.linkMode(), "off", "默认应为 off");
        await cfg.update("link.mode", "file", vscode.ConfigurationTarget.Global);
        assert.strictEqual(api.linkMode(), "file", "显式设 mode=file 应生效");
        state = await api.dbReadiness();
        assert.strictEqual(state.linkMode, "file", "dbReadiness 应反映 mode");
        await cfg.update("link.mode", undefined, vscode.ConfigurationTarget.Global);

        // 已有全量链接资料（新布局）→ linkHasData
        fs.mkdirSync(path.join(root, ".project", "link"), { recursive: true });
        fs.writeFileSync(path.join(root, ".project", "link", "links.jsonl"), "{}\n");
        state = await api.dbReadiness();
        assert.strictEqual(state.linkHasData, true, "有 links.jsonl 应视为已有全量链接资料");
        assert.strictEqual(state.linkDir, ".project/link", `链接目录应为新布局，实际 ${state.linkDir}`);

        // 旧布局也要认（只做过 mode ① 的老工程）
        fs.rmSync(path.join(root, ".project", "link"), { recursive: true, force: true });
        fs.writeFileSync(path.join(root, ".project", "links.jsonl"), "{}\n");
        state = await api.dbReadiness();
        assert.strictEqual(state.linkHasData, true, "旧布局 links.jsonl 也应认");
        assert.strictEqual(state.linkDir, ".project", `旧布局目录应为 .project，实际 ${state.linkDir}`);

        // 字段资料（新布局）→ schemaHasData
        fs.mkdirSync(path.join(root, ".project", "schema"), { recursive: true });
        fs.writeFileSync(path.join(root, ".project", "schema", "tables.json"), "{}");
        state = await api.dbReadiness();
        assert.strictEqual(state.schemaHasData, true, "有 tables.json 应视为已有全量字段资料");
        assert.strictEqual(state.schemaDir, ".project/schema", `字段目录应为新布局，实际 ${state.schemaDir}`);

        // Oracle 三项配齐 → configured
        await cfg.update("prod.oracle.host", "127.0.0.1", vscode.ConfigurationTarget.Global);
        await cfg.update("prod.oracle.service", "E2E", vscode.ConfigurationTarget.Global);
        await cfg.update("prod.oracle.user", "e2e", vscode.ConfigurationTarget.Global);
        state = await api.dbReadiness();
        assert.strictEqual(state.configured, true, "三项配齐时 configured 应为 true");
      } finally {
        for (const key of oracleKeys) {
          await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
        fs.rmSync(path.join(root, ".project"), { recursive: true, force: true });
      }
    });

    // W3/W4：门控条件必须真的写进 manifest 的 when（否则按钮不会隐藏）。
    await test("W3/W4：按钮门控写进 package.json 的 when", async () => {
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ext.extensionPath, "package.json"), "utf8"),
      );
      const menus = JSON.stringify(pkg.contributes.menus);
      for (const key of ["bdl.db.configured", "bdl.link.hasData", "bdl.schema.hasData"]) {
        assert.ok(menus.includes(key), `menus.when 应包含 ${key}`);
      }
      assert.ok(
        menus.includes("bdl.link.updateFromDb"),
        "链接视图标题栏应有「从数据库更新」按钮",
      );
    });

    // W5：占位符语义与 MAIN 判定（纯函数，不跑外部命令）。
    await test("W5：编译占位符与 MAIN 判定", async () => {
      const root = process.env.BDL_E2E_WORKSPACE;
      assert.ok(root, "缺少 BDL_E2E_WORKSPACE");
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      assert.ok(
        api.expandBuildTemplate && api.buildPlaceholders && api.hasMainProgram,
        "应导出 W5 API",
      );

      // 模板展开：四个占位符都替换，且不做多余处理。
      const got = api.expandBuildTemplate(
        "cd ${path} && r.c2 ${name} && echo ${fullpath} ${fullname}",
        {
          path: "axc/4gl",
          fullpath: "tiptop/axc/4gl",
          name: "axcp500",
          fullname: "axcp500.4gl",
        },
      );
      assert.strictEqual(
        got,
        "cd axc/4gl && r.c2 axcp500 && echo tiptop/axc/4gl axcp500.4gl",
      );

      // MAIN 判定：只认独占一行的 MAIN 程序块。
      assert.strictEqual(api.hasMainProgram("MAIN\n  DISPLAY 1\nEND MAIN\n"), true);
      assert.strictEqual(api.hasMainProgram("  MAIN  -- 入口\nEND MAIN\n"), true);
      assert.strictEqual(api.hasMainProgram("FUNCTION f()\nEND FUNCTION\n"), false);
      assert.strictEqual(api.hasMainProgram("DEFINE main LIKE x\n"), false);

      // 目录层级：tiptop/apm/4gl/axcp500.4gl → path=apm/4gl，fullpath=tiptop/apm/4gl。
      const dir = path.join(root, "tiptop", "apm", "4gl");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "axcp500.4gl");
      fs.writeFileSync(file, "MAIN\nEND MAIN\n");
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const params = api.buildPlaceholders(doc, "custom");
      assert.strictEqual(params.path, "apm/4gl", `path 应为两层，实际 ${params.path}`);
      assert.strictEqual(
        params.fullpath,
        "tiptop/apm/4gl",
        `fullpath 应为三层，实际 ${params.fullpath}`,
      );
      assert.strictEqual(params.name, "custom");
      assert.strictEqual(params.fullname, "axcp500.4gl");
    });

    // W5/§0d：编译命令改为在生产服务器执行——插件只负责组装 `tiptop exec` 参数。
    await test("W5：编译命令走 tiptop exec", async () => {
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const api = await ext.activate();
      const cfg = vscode.workspace.getConfiguration("bdl");

      // 新键 `.command` 优先生效
      const tpl = "cd ${path} && echo ${name}>marker";
      await cfg.update("build.4gl.preview.command", tpl, vscode.ConfigurationTarget.Global);
      try {
        assert.strictEqual(
          api.buildCommandFor("4gl", "preview"),
          tpl,
          "新键 bdl.build.4gl.preview.command 应被读到",
        );
        // 旧键（`bdl.build.4gl.preview` 直接当命令）已从清单移除，
        // VSCode 不允许再写入未注册键；兼容读取只对"老 settings.json 里已有的值"生效，
        // 这里只验证"新键清空后回退内置默认值"。
        await cfg.update(
          "build.4gl.preview.command",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
        assert.strictEqual(
          api.buildCommandFor("4gl", "preview"),
          "cd ${path} && r.c2 ${name}",
          "新键清空后应回退内置默认值",
        );
      } finally {
        await cfg.update("build.4gl.preview.command", undefined, vscode.ConfigurationTarget.Global);
        await cfg.update("build.4gl.preview", undefined, vscode.ConfigurationTarget.Global);
      }

      // 内置默认值（Form 预览是三个参数：${name} 2 p）
      assert.strictEqual(
        api.buildCommandFor("per", "form"),
        "cd ${path} && r.gf ${name} 2 p",
        "Form 预览默认命令应含 '2 p'",
      );
      // 组装成 tiptop exec 参数（生产服务器执行；不自动上传）
      assert.deepStrictEqual(
        api.buildTiptopArgs("/ws", "tiptop/apm/4gl/axcp500.4gl", "r.l2 axcp500"),
        [
          "exec",
          "-workspace",
          "/ws",
          "-file",
          "tiptop/apm/4gl/axcp500.4gl",
          "-command",
          "r.l2 axcp500",
        ],
        "编译命令应交给 tiptop exec",
      );
    });

    // W5：六个按钮与设置键都写进 manifest，链接按钮带 MAIN 门控。
    await test("W5：编译按钮与设置写进 manifest", async () => {
      const ext = vscode.extensions.getExtension("darcyjoven.4gl-full");
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ext.extensionPath, "package.json"), "utf8"),
      );
      const ids = [
        "bdl.build.4gl.preview",
        "bdl.build.4gl.compile",
        "bdl.build.4gl.link",
        "bdl.build.per.preview",
        "bdl.build.per.compile",
        "bdl.build.per.form",
      ];
      const editorMenus = JSON.stringify(pkg.contributes.menus["editor/title"]);
      for (const id of ids) {
        assert.ok(editorMenus.includes(id), `编辑器工具栏应有 ${id}`);
      }
      assert.ok(
        JSON.stringify(pkg.contributes.menus).includes("bdl.build.hasMain"),
        "4GL 链接按钮应有 MAIN 门控",
      );
      const props = pkg.contributes.configuration.flatMap((sec) =>
        Object.keys(sec.properties),
      );
      for (const id of ids) {
        assert.ok(props.includes(`${id}.command`), `设置应包含 ${id}.command`);
        // C10：不再有 per-command enable
        assert.ok(!props.includes(`${id}.enable`), `${id}.enable 应已删除（C10）`);
      }
      // §0d：编译图标改成运行形状，视图按钮图标化
      const cmds = pkg.contributes.commands;
      const iconOf = (id) =>
        (cmds.find((c) => c.command === id) || {}).icon;
      assert.strictEqual(
        iconOf("bdl.build.4gl.compile"),
        "$(play)",
        "4GL 编译图标应是运行形状",
      );
      assert.strictEqual(
        iconOf("bdl.build.per.compile"),
        "$(play)",
        "Form 编译图标应是运行形状",
      );
      for (const id of [
        "bdl.schema.filter",
        "bdl.schema.refresh",
        "bdl.schema.import",
        "bdl.link.updateFromDb",
      ]) {
        assert.ok(iconOf(id), `${id} 应有图标（标题栏不再显示长文字）`);
      }
    });

  } finally {
    report();
  }
}

/**
 * 执行可能弹提示框的命令，但**不 await**。
 *
 * e2e 是无人值守的：`showWarningMessage` / `showInputBox` 这类会一直等着用户点，
 * `await executeCommand(...)` 会把扩展宿主挂死。这里只求"能跑起来、不抛错"。
 */
function fireAndForget(command, ...args) {
  vscode.commands.executeCommand(command, ...args).then(
    () => {},
    () => {},
  );
}

/** 写一份最小字段资料夹具（两条表）。多个用例共用，避免复制粘贴。 */
function writeSchemaFixture(root) {
  const schemaDir = path.join(root, ".project", "schema");
  fs.mkdirSync(path.join(schemaDir, "tables"), { recursive: true });
  fs.writeFileSync(
    path.join(schemaDir, "tables.json"),
    JSON.stringify({
      schema: 1,
      importedAt: "2026-10-23T21:00:00+08:00",
      source: "gal_schema.csv",
      rowsTotal: 4,
      tables: {
        APA_FILE: { name: "apa_file", desc: "", columns: 2, file: "APA_FILE.json" },
        IMA_FILE: { name: "ima_file", desc: "物料主档", columns: 2, file: "IMA_FILE.json" },
      },
    }),
  );
  fs.writeFileSync(
    path.join(schemaDir, "tables", "APA_FILE.json"),
    JSON.stringify({
      table: "APA_FILE",
      columns: [
        { name: "apa01", desc: "物料编号", type: "VARCHAR2", length: 10 },
        { name: "apa02", desc: "数量", type: "NUMBER", precision: 5 },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(schemaDir, "tables", "IMA_FILE.json"),
    JSON.stringify({
      table: "IMA_FILE",
      columns: [{ name: "ima01", desc: "物料编号", type: "CHAR", length: 10 }],
    }),
  );
}

/** 清掉字段资料夹具（避免影响其它用例，尤其是"轻量档不写项目"那条）。 */
function removeSchemaFixture(root) {
  fs.rmSync(path.join(root, ".project"), { recursive: true, force: true });
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
