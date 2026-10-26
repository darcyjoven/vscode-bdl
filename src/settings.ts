// 设置读取与旧键兼容（TODO §0d T1/T5）。
//
// 设置面板已重构成 3 组：基本设置 / 账号、生产环境、配置 / 上传编译链接。
// 键名大多沿用，但语义有变化（link/schema 从 enable 布尔变成 mode 三态、
// build 从 6 个命令键拆成 enable+command、上传只留单文件）。
//
// 这里集中处理"显式设置值 + 旧键回退"，避免各文件各自 `get()` 出现不一致。
import * as vscode from "vscode";

/** 链接/字段资料的三态。 */
export type DataMode = "off" | "file" | "db";
/** 上传方式。 */
export type Transport = "off" | "rsync" | "scp";

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bdl");
}

/**
 * 取"用户是否显式设过"的值（任一作用域）。
 *
 * 需要它来区分"用户显式设成默认值"与"没设过、拿到默认值"——旧键迁移就靠这个。
 */
function explicit<T>(key: string): T | undefined {
  const i = cfg().inspect<T>(key);
  if (!i) {
    return undefined;
  }
  return (
    i.workspaceFolderValue ?? i.workspaceValue ?? i.globalValue ?? undefined
  );
}

function asMode(v: unknown): DataMode | undefined {
  return v === "off" || v === "file" || v === "db" ? v : undefined;
}

/**
 * 链接资料模式（`bdl.link.mode`）。
 *
 * 兼容旧 `bdl.link.enable`：没设过 mode 时，旧 enable=true → `db`，否则 `off`。
 */
export function linkMode(): DataMode {
  const v = asMode(explicit("link.mode"));
  if (v !== undefined) {
    return v;
  }
  if (explicit<boolean>("link.enable") === true) {
    return "db";
  }
  return "off";
}

/** 数据库字段模式（`bdl.schema.mode`），旧 `bdl.schema.enable` 同理。 */
export function schemaMode(): DataMode {
  const v = asMode(explicit("schema.mode"));
  if (v !== undefined) {
    return v;
  }
  if (explicit<boolean>("schema.enable") === true) {
    return "db";
  }
  return "off";
}

/** 链接资料功能是否启用（mode != off）。 */
export function linkEnabled(): boolean {
  return linkMode() !== "off";
}

/** 数据库字段功能是否启用（mode != off）。 */
export function schemaEnabled(): boolean {
  return schemaMode() !== "off";
}

/**
 * 上传方式（`bdl.prod.deploy.transport`）。
 *
 * 兼容旧配置：旧键只有 rsync|scp；若没设过 transport 但显式开了 `bdl.deploy.enable`，
 * 按旧的默认行为给 `rsync`，避免老用户升级后上传命令直接消失。
 */
export function transport(): Transport {
  const v = explicit<string>("prod.deploy.transport");
  if (v === "off" || v === "rsync" || v === "scp") {
    return v;
  }
  if (explicit<boolean>("deploy.enable") === true) {
    return "rsync";
  }
  return "off";
}

/** 上传功能是否可用（组总开关 + transport != off）。 */
export function uploadEnabled(): boolean {
  return cfg().get<boolean>("deploy.enable", false) && transport() !== "off";
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
 * 某个编译方式的命令模板。
 *
 * 新键 `bdl.build.<lang>.<mode>.command` 优先；兼容旧键（旧版本直接把这 6 个键
 * 当命令模板）。都没设过返回 undefined，交给调用方回退内置默认值。
 */
export function buildCommandValue(
  lang: string,
  mode: string,
): string | undefined {
  const v = explicit<string>(`build.${lang}.${mode}.command`);
  if (typeof v === "string" && v.trim() !== "") {
    return v;
  }
  return explicit<string>(`build.${lang}.${mode}`);
}