// e2e 驱动：在真实的 VSCode 扩展宿主里加载本扩展并跑测试套件。
//
// 本机沙箱踩过的坑，逐条对应下面的代码：
//   1. 无 root、无 X server    → `--ozone-platform=headless`
//   2. /dev/shm 不可写         → `--disable-dev-shm-usage`
//   3. TMPDIR / XDG_RUNTIME_DIR 必须存在、可写且持久，否则窗口进程秒退
//   4. 测试入口必须位于扩展目录内，否则 require("vscode") 拿不到 API
//   5. VSCode 的进程退出码不反映测试结果（实测恒为 0），以 JSON 报告为准
//   6. 缺省日志级别下窗口可能提前退出，必须带 `--verbose`
//   7. 上一轮残留的 VSCode 进程会抢占单实例锁，启动前先清理
//
// 跨平台说明（Windows 上要额外注意）：
//   - 可执行文件名是 `Code.exe`，不在 PATH 里时按标准安装路径探测；
//   - 清理进程用 `taskkill /F /IM Code.exe`，没有 pkill/pgrep；
//   - `--ozone-platform=headless` 等 Linux 专属参数不传，避免 Windows 报未知开关；
//   - `chmod` 在 Windows 上是空操作，跳过。
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { runTests } = require("@vscode/test-electron");

const isWindows = process.platform === "win32";

/** 在 PATH 中定位 VSCode 可执行文件。 */
function findVSCodeExecutable() {
  const explicit = process.env.BDL_VSCODE_EXECUTABLE;
  if (explicit && fs.existsSync(explicit)) {
    return fs.realpathSync(explicit);
  }

  const names = isWindows ? ["Code.exe", "code.cmd", "code"] : ["code"];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  if (isWindows) {
    // Windows 安装器默认不把 VSCode 加进 PATH，补几条常见位置
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    if (localAppData) {
      dirs.push(path.join(localAppData, "Programs", "Microsoft VS Code", "bin"));
      dirs.push(path.join(localAppData, "Programs", "Microsoft VS Code"));
    }
    if (programFiles) {
      dirs.push(path.join(programFiles, "Microsoft VS Code", "bin"));
      dirs.push(path.join(programFiles, "Microsoft VS Code"));
    }
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        const st = fs.lstatSync(candidate);
        if (st.isSymbolicLink() || st.isFile()) {
          return fs.realpathSync(candidate);
        }
      } catch {
        // 换下一个
      }
    }
  }
  throw new Error(
    isWindows
      ? "找不到 VSCode 可执行文件，请设置 BDL_VSCODE_EXECUTABLE 指向 Code.exe"
      : "找不到 VSCode 可执行文件，请设置 BDL_VSCODE_EXECUTABLE 或先 source bdl-lsp/scripts/dev-env.sh",
  );
}

/** 阻塞等待若干毫秒（不引入额外依赖）。 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 清理残留的 VSCode 进程。
 *
 * 沙箱里 `timeout` 只杀主进程，子进程会继续持有单实例锁，
 * 导致后续运行"启动即退出"且没有任何错误日志——极难排查。
 */
function killStaleProcesses(executable) {
  if (isWindows) {
    // Windows 没有 pkill；按镜像名杀，精确到 Code.exe 避免误伤
    for (const image of ["Code.exe", "Code - Insiders.exe"]) {
      try {
        execFileSync("taskkill", ["/F", "/IM", image], { stdio: "ignore" });
      } catch {
        // 没有匹配的进程时 taskkill 退出码非 0，属正常
      }
    }
    sleep(500); // 给句柄释放留点时间
    return;
  }

  const appDir = path.dirname(path.dirname(executable)); // .../vscode
  try {
    execFileSync("pkill", ["-f", appDir], { stdio: "ignore" });
  } catch {
    // pkill 找不到匹配时退出码非 0，属正常
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      execFileSync("pgrep", ["-f", appDir], { stdio: "ignore" });
      // 还活着，等一会
      sleep(200);
    } catch {
      return; // 已清理干净
    }
  }
}

/** 准备 tmp 与 XDG_RUNTIME_DIR：必须存在且可写。 */
function prepareRuntimeDirs(root) {
  const tmp = path.join(root, "tmp");
  const runtime = path.join(root, "run");
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  if (!isWindows) {
    // Chromium 要求 XDG_RUNTIME_DIR 权限为 0700；Windows 上 chmod 无意义
    fs.chmodSync(runtime, 0o700);
  }
  return { tmp, runtime };
}

/**
 * 解析 bdl-lsp 可执行文件路径。
 *
 * 顺序：BDL_LSP_PATH → PATH 查找 → 仓库内 artifacts/bin。
 * 返回绝对路径；找不到返回 undefined（测试会据此跳过/报错）。
 */
function resolveLspBinary() {
  const name = isWindows ? "bdl-lsp.exe" : "bdl-lsp";

  const explicit = (process.env.BDL_LSP_PATH ?? "").trim();
  if (explicit) {
    const stat = fs.existsSync(explicit) ? fs.statSync(explicit) : undefined;
    if (stat?.isFile()) {
      return explicit;
    }
    if (stat?.isDirectory()) {
      const inside = path.join(explicit, name);
      if (fs.existsSync(inside)) {
        return inside;
      }
    }
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const fallback = path.resolve(
    __dirname,
    "..",
    "..",
    "bdl-lsp",
    "artifacts",
    "bin",
    name,
  );
  return fs.existsSync(fallback) ? fallback : undefined;
}

/** 准备临时工作区，放入测试用的 4gl/per 文件。 */
function prepareWorkspace(base) {
  const dir = path.join(base, "ws");
  fs.mkdirSync(dir, { recursive: true });
  const fixtures = path.join(__dirname, "fixtures");
  for (const name of fs.readdirSync(fixtures)) {
    fs.copyFileSync(path.join(fixtures, name), path.join(dir, name));
  }
  return dir;
}

/** 解释报告，打印结果并返回是否全部通过。 */
function summarize(reportFile) {
  const results = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(
    `[e2e] 用例 ${results.length - failed.length}/${results.length} 通过`,
  );
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} (${r.ms}ms)`);
    if (!r.ok && r.error) {
      console.log(
        String(r.error)
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    }
  }
  return failed.length === 0;
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.join(__dirname, "suite", "index.js");
  if (!fs.existsSync(extensionTestsPath)) {
    throw new Error(`测试入口不存在: ${extensionTestsPath}`);
  }

  const base = process.env.BDL_E2E_BASE
    ? path.resolve(process.env.BDL_E2E_BASE)
    : path.join(os.tmpdir(), "bdl-e2e");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });

  const { tmp, runtime } = prepareRuntimeDirs(base);
  const workspace = prepareWorkspace(base);
  const userDataDir = path.join(base, "user-data");
  const extensionsDir = path.join(base, "extensions");
  const reportFile = process.env.BDL_E2E_REPORT
    ? path.resolve(process.env.BDL_E2E_REPORT)
    : path.join(base, "report.json");
  fs.rmSync(reportFile, { force: true });

  const executable = findVSCodeExecutable();
  killStaleProcesses(executable);

  // Chromium 与 node 都读这些变量，必须在启动子进程之前设置
  process.env.TMPDIR = tmp;
  process.env.TMP = tmp;
  process.env.TEMP = tmp;
  process.env.XDG_RUNTIME_DIR = runtime;

  console.log(`[e2e] VSCode   : ${executable}`);
  console.log(`[e2e] 工作区   : ${workspace}`);
  console.log(`[e2e] 报告     : ${reportFile}`);

  let exitCode;
  try {
    exitCode = await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace,
        "--user-data-dir",
        userDataDir,
        "--extensions-dir",
        extensionsDir,
        "--disable-gpu",
        // 不弹工作区信任提示，否则扩展不会启动
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-telemetry",
        "--disable-updates",
        "--disable-crash-reporter",
        // 缺省级别下窗口会提前退出，实测必须 verbose
        "--verbose",
        // Linux 专属：无 X server + /dev/shm 不可写。
        // Windows 传这些会被当成未知开关，因此按平台裁剪。
        ...(isWindows
          ? []
          : [
              "--ozone-platform=headless",
              "--no-sandbox",
              "--disable-dev-shm-usage",
            ]),
      ],
      extensionTestsEnv: {
        BDL_E2E_WORKSPACE: workspace,
        // 显式解析并传入，让测试与语言客户端用同一个二进制；
        // 不依赖调用者事先 export（dev-env.sh 只把它放进 PATH）。
        BDL_LSP_PATH: resolveLspBinary() ?? "",
        BDL_E2E_REPORT: reportFile,
      },
    });
  } finally {
    killStaleProcesses(executable);
  }

  console.log(`[e2e] VSCode 退出码=${exitCode}`);

  // 退出码不可靠，以报告文件为准
  if (!fs.existsSync(reportFile)) {
    console.error(
      `[e2e] 未生成测试报告：测试套件没有运行。\n` +
        `[e2e] 请检查 ${base}/user-data/logs/ 下的日志。`,
    );
    if (!process.env.BDL_E2E_KEEP) {
      fs.rmSync(base, { recursive: true, force: true });
    }
    process.exit(1);
  }

  const ok = summarize(reportFile);
  if (!ok) {
    console.error(`\n[e2e] 存在失败用例，日志保留在 ${base}/user-data/logs/`);
    process.exit(1);
  }
  if (!process.env.BDL_E2E_KEEP) {
    fs.rmSync(base, { recursive: true, force: true });
  }
  console.log("\n[e2e] 全部通过");
  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e] 运行失败:", err);
  process.exit(1);
});
