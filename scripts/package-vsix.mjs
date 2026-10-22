#!/usr/bin/env node
// 打包 VSIX：默认把当前平台的两个二进制一起打进去，安装后开箱即用：
//
//   bin/bdl-lsp   语言服务器（只做语言智能）
//   bin/tiptop    链接资料采集 + 部署（从 bdl-lsp 分离出来的工具）
//
// 用法：
//   node scripts/package-vsix.mjs             # 平台包（推荐，需要两个二进制）
//   node scripts/package-vsix.mjs --dev       # 开发包（不含二进制，只用于 CI 冒烟）
//   node scripts/package-vsix.mjs --target win32-x64
//
// 环境变量：
//   BDL_LSP_BINARY    语言服务器二进制路径；默认 ../bdl-lsp/artifacts/bin/bdl-lsp[.exe]
//   BDL_LSP_VERSION   写入 BUILD-INFO.json 的版本；默认执行二进制 version
//   TIPTOP_BINARY     tiptop 二进制路径；默认 ../tiptop/artifacts/bin/tiptop[.exe]
//   TIPTOP_VERSION    写入 BUILD-INFO.json 的版本；默认执行二进制 version
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

const binDir = path.join(root, "bin");
const outDir = path.join(root, "dist-vsix");
const version = pkg.version;
const outFile = path.join(
  outDir,
  `${pkg.name}-${version}${dev ? "-dev" : `-${target}`}.vsix`,
);

/**
 * 需要内置的两个二进制。
 *
 * 语言服务器与 tiptop 分属两个仓库：前者只做语言智能，后者做采集与部署。
 * 两者版本号独立，都要记进 BUILD-INFO.json，出问题时才好定位。
 */
const binaries = [
  {
    key: "lspVersion",
    base: "bdl-lsp",
    envBinary: "BDL_LSP_BINARY",
    envVersion: "BDL_LSP_VERSION",
    repo: "bdl-lsp",
    label: "语言服务器",
  },
  {
    key: "tiptopVersion",
    base: "tiptop",
    envBinary: "TIPTOP_BINARY",
    envVersion: "TIPTOP_VERSION",
    repo: "tiptop",
    label: "tiptop（采集/部署）",
  },
].map((b) => ({ ...b, name: target.startsWith("win32-") ? `${b.base}.exe` : b.base }));

/** 根据平台推断某个二进制的源位置。 */
function defaultBinarySource(b) {
  const sourceName = process.platform === "win32" ? `${b.base}.exe` : b.base;
  return path.resolve(root, "..", b.repo, "artifacts", "bin", sourceName);
}

/** 执行二进制拿版本号；跨平台打包时由对应的 *_VERSION 提供。 */
function detectVersion(b, binaryPath) {
  const forced = process.env[b.envVersion]?.trim();
  if (forced) {
    return forced;
  }
  try {
    const r = spawnSync(binaryPath, ["version"], { encoding: "utf8" });
    if (r.status === 0) {
      const m = new RegExp(`${b.base}\\s+(\\S+)`).exec(r.stdout);
      if (m) {
        return m[1];
      }
    }
  } catch {
    // 跨平台打包时无法执行目标平台的二进制，走源码兜底
  }
  try {
    const mainGo = path.resolve(root, "..", b.repo, "main.go");
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

const detected = {};

if (!dev) {
  resetBin();
  for (const b of binaries) {
    const source = path.resolve(
      process.env[b.envBinary]?.trim() || defaultBinarySource(b),
    );
    if (!fs.existsSync(source)) {
      fail(
        `找不到${b.label}二进制：${source}\n` +
          `先在 ${b.repo} 执行 make build，或设置 ${b.envBinary} 指向对应平台的二进制。`,
      );
    }
    detected[b.key] = detectVersion(b, source);
    fs.copyFileSync(source, path.join(binDir, b.name));
    copyRuntimeDlls(path.dirname(source));
    if (!target.startsWith("win32-")) {
      fs.chmodSync(path.join(binDir, b.name), 0o755);
    }

    // 同平台打包时先跑一次 version：CGO/动态库问题不能等到用户安装后才暴露。
    if (target.startsWith(`${process.platform}-`)) {
      const probe = spawnSync(path.join(binDir, b.name), ["version"], {
        encoding: "utf8",
      });
      if (probe.status !== 0) {
        fail(
          `内置 ${b.base} 无法运行（exit=${probe.status}）：\n${probe.stdout ?? ""}${probe.stderr ?? ""}`,
        );
      }
      console.log(`内置 ${b.base} ${detected[b.key]}：${probe.stdout.trim()}`);
    }
  }
  fs.writeFileSync(
    path.join(binDir, "BUILD-INFO.json"),
    `${JSON.stringify(
      {
        target,
        lspVersion: detected.lspVersion,
        tiptopVersion: detected.tiptopVersion,
        extensionVersion: version,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
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
  console.log(
    `  内置：${binaries.map((b) => `bin/${b.name}（${b.base} ${detected[b.key]}）`).join("、")}`,
  );
}
