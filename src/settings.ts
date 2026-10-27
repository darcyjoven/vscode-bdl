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

/**
 * 生产服务器登录后要输入的「区」（`bdl.prod.deploy.region`），默认 `1`。
 *
 * 只影响**在生产服务器上执行**的命令（编译 / 链接 / 预览画面）：远端 login shell
 * 可能先问区，没人回答就什么也不跑。返回空串表示未配置，调用方要直接报错。
 */
export function serverRegion(): string {
  const v = cfg().get<string>("prod.deploy.region", "1");
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 区域 → 登录环境脚本（站点约定：1=topprod、2=toptest、3=topstd；
 * 4=Browser-based 没有对应的 profile）。
 *
 * 该脚本会改工作目录，所以 tiptop 一定在 `cd 生产根` 之前 source 它。
 */
export function loginProfileForRegion(region: string): string {
  switch (region) {
    case "1":
      return "/u1/usr/profile/profile.topprod";
    case "2":
      return "/u1/usr/profile/profile.toptest";
    case "3":
      return "/u1/usr/profile/profile.topstd";
    default:
      return "";
  }
}
