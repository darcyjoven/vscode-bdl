// 设置读取（TODO §0d「设置重构 V2」）。
//
// 设置面板分 3 组：基本设置 / 账号、生产环境、配置 / 上传编译链接。
// 只读当前键——项目尚未发布，不保留任何旧键兼容。
import * as vscode from "vscode";

/** 链接/字段资料的三态。 */
export type DataMode = "off" | "file" | "db";
/** 上传方式。 */
export type Transport = "off" | "rsync" | "scp";

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bdl");
}

/** 链接资料模式（`bdl.link.mode`）。 */
export function linkMode(): DataMode {
  const v = cfg().get<string>("link.mode", "off");
  return v === "file" || v === "db" ? v : "off";
}

/** 数据库字段模式（`bdl.schema.mode`）。 */
export function schemaMode(): DataMode {
  const v = cfg().get<string>("schema.mode", "off");
  return v === "file" || v === "db" ? v : "off";
}

/** 链接资料功能是否启用（mode != off）。 */
export function linkEnabled(): boolean {
  return linkMode() !== "off";
}

/** 数据库字段功能是否启用（mode != off）。 */
export function schemaEnabled(): boolean {
  return schemaMode() !== "off";
}

/** 上传方式（`bdl.prod.deploy.transport`）。 */
export function transport(): Transport {
  const v = cfg().get<string>("prod.deploy.transport", "off");
  return v === "rsync" || v === "scp" ? v : "off";
}

/** 上传功能是否可用（组总开关 + transport != off）。 */
export function uploadEnabled(): boolean {
  return (
    cfg().get<boolean>("deploy.enable", false) && transport() !== "off"
  );
}

/** 编译/链接/预览总开关。 */
export function buildEnabled(): boolean {
  return cfg().get<boolean>("build.enable", false);
}

/** 某个编译方式是否启用（`bdl.build.<lang>.<mode>.enable`，默认 true）。 */
export function buildCommandEnabled(lang: string, mode: string): boolean {
  return cfg().get<boolean>(`build.${lang}.${mode}.enable`, true);
}

/**
 * 某个编译方式的命令模板（`bdl.build.<lang>.<mode>.command`）。
 *
 * 空/未设置返回 undefined，由调用方回退内置默认值（见 build.ts 的 BUILD_DEFAULTS）。
 */
export function buildCommandValue(
  lang: string,
  mode: string,
): string | undefined {
  const v = cfg().get<string>(`build.${lang}.${mode}.command`);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
