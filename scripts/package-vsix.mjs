#!/usr/bin/env node
// 打包 VSIX：默认把当前平台的 bdl-lsp 一起打进去，安装后无需单独装语言服务器。
//
// 用法：
//   node scripts/package-vsix.mjs             # 平台包（推荐，需要 bdl-lsp 二进制）
//   node scripts/package-vsix.mjs --dev       # 开发包（不含二进制，只用于 CI 冒烟）
//   node scripts/package-vsix.mjs --target win32-x64
//
// 环境变量：
//   BDL_LSP_BINARY    源二进制路径；默认 ../bdl-lsp/artifacts/bin/bdl-lsp[.exe]
//   BDL_LSP_VERSION   写入 bin/BUILD-INFO.json 的版本；默认执行二进制 version
//   BDL_VSCODE_TARGET 覆盖目标平台；默认按当前 process.platform/arch 推断
//
// 平台 VSIX 只包含对应平台的二进制。VSCode 用 `--target` 记录平台，
// 市场/安装器据此只给用户匹配的包。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dev = process.argv.includes("--dev");

function fail(message) {
  console.error(`\n[package-vsix] ${message}\n`);
  process.exit(1);
}

/** 推断 VSCode 平台标识；只列当前实际构建的目标。 */
function defaultTarget() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  switch (process.platform) {
    case "win32":
      return `win32-${arch}`;
    case "linux":
      return `linux-${arch}`;
    case "darwin":
      return `darwin-${arch}`;
    default:
      fail(`不支持当前平台 ${process.platform}/${process.arch}`);
  }
}

function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) {
    return undefined;
  }
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} 需要一个值`);
  }
  return value;
}

const target = process.env.BDL_VSCODE_TARGET?.trim() || readFlag("--target") || defaultTarget();
if (!/^(win32|linux|darwin)-(x64|arm64)$/.test(target)) {
  fail(`不认识的目标平台：${target}（支持 win32/linux/darwin 的 x64/arm64）`);
}

const binaryName = target.startsWith("win32-") ? "bdl-lsp.exe" : "bdl-lsp";
const binDir = path.join(root, "bin");
const outDir = path.join(root, "dist-vsix");
const version = pkg.version;
const outFile = path.join(
  outDir,
  `${pkg.name}-${version}${dev ? "-dev" : `-${target}`}.vsix`,
);

/** 根据平台推断源二进制位置。 */
function defaultBinarySource() {
  const sourceName = process.platform === "win32" ? "bdl-lsp.exe" : "bdl-lsp";
  return path.resolve(root, "..", "bdl-lsp", "artifacts", "bin", sourceName);
}

/** 执行二进制拿版本号；跨平台打包时由 BDL_LSP_VERSION 提供。 */
function detectLspVersion(binaryPath) {
  const forced = process.env.BDL_LSP_VERSION?.trim();
  if (forced) {
    return forced;
  }
  try {
    const r = spawnSync(binaryPath, ["version"], { encoding: "utf8" });
    if (r.status === 0) {
      const m = /bdl-lsp\s+(\S+)/.exec(r.stdout);
      if (m) {
        return m[1];
      }
    }
  } catch {
    // 跨平台打包时无法执行目标平台的二进制，走 main.go 兜底
  }
  try {
    const mainGo = path.resolve(root, "..", "bdl-lsp", "main.go");
    const text = fs.readFileSync(mainGo, "utf8");
    const m = /var version = "([^"]+)"/.exec(text);
    if (m) {
      return m[1];
    }
  } catch {
    // 源码不在旁边，返回 unknown
  }
  return "unknown";
}

function resetBin() {
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });
}

function copyRuntimeDlls(sourceDir) {
  if (!target.startsWith("win32-")) {
    return;
  }
  for (const name of fs.readdirSync(sourceDir)) {
    if (name.toLowerCase().endsWith(".dll")) {
      fs.copyFileSync(path.join(sourceDir, name), path.join(binDir, name));
    }
  }
}

let lspVersion = "dev";
if (!dev) {
  const source = path.resolve(
    process.env.BDL_LSP_BINARY?.trim() || defaultBinarySource(),
  );
  if (!fs.existsSync(source)) {
    fail(
      `找不到语言服务器二进制：${source}\n` +
        "先在 bdl-lsp 执行 make build，或设置 BDL_LSP_BINARY 指向对应平台的二进制。",
    );
  }
  lspVersion = detectLspVersion(source);
  resetBin();
  fs.copyFileSync(source, path.join(binDir, binaryName));
  copyRuntimeDlls(path.dirname(source));
  if (!target.startsWith("win32-")) {
    fs.chmodSync(path.join(binDir, binaryName), 0o755);
  }
  fs.writeFileSync(
    path.join(binDir, "BUILD-INFO.json"),
    `${JSON.stringify({ target, lspVersion, extensionVersion: version, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );

  // 同平台打包时先跑一次 version：CGO/动态库问题不能等到用户安装后才暴露。
  if (target.startsWith(`${process.platform}-`)) {
    const probe = spawnSync(path.join(binDir, binaryName), ["version"], {
      encoding: "utf8",
    });
    if (probe.status !== 0) {
      fail(
        `内置二进制无法运行（exit=${probe.status}）：\n${probe.stdout ?? ""}${probe.stderr ?? ""}`,
      );
    }
    console.log(`内置 bdl-lsp ${lspVersion}：${probe.stdout.trim()}`);
  }
} else {
  resetBin();
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const vsce = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);
if (!fs.existsSync(vsce)) {
  fail(`找不到 ${vsce}，请先 npm ci --include=dev`);
}

const args = [
  "package",
  "--no-dependencies",
  "--allow-missing-repository",
  "--skip-license",
  "--out",
  outFile,
];
if (!dev) {
  args.push("--target", target);
}
const r = spawnSync(vsce, args, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) {
  fail(`vsce package 失败（exit=${r.status ?? "signal"}）`);
}
console.log(`\n已生成 ${path.relative(root, outFile)}`);
if (!dev) {
  console.log(`  平台：${target}`);
  console.log(`  内置：bin/${binaryName}（bdl-lsp ${lspVersion}）`);
}
