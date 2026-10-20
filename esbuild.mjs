// esbuild 打包脚本：把扩展打成单文件 dist/extension.js。
//
// 为什么打包：vscode-languageclient 会带出十几个依赖目录，直接发布源码树
// 会让 VSIX 体积翻十几倍；单文件产物同时加快激活速度。
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  // vscode 由宿主提供，不能打进产物
  external: ["vscode"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
