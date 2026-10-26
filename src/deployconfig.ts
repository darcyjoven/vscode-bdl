// 部署配置合成（§0d）：用户只改 VSCode 设置，插件是
// `.project/deploy/deploy.json` 的**唯一写入者**。
//
// 契约：tiptop 的配置模型不变（targets / upload）；插件把「账号、生产环境、配置」
// 与「上传编译链接」两组设置翻译成同一份 JSON，`tiptop upload` / `tiptop exec` 用它。
//
// §0d：只支持**单文件上传**——不再生成 include / exclude / delete / compile
//（用户明确不允许批量同步；编译命令由 `tiptop exec -command` 直接传入）。
//
// 安全：文件里只有主机名/账号/路径（没有密码），但仍建议不进 git（生产主机信息）。
// 不是本插件生成的文件（没有 `createdBy`）在覆盖前会备份成 `deploy.json.bak`。
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { transport, type Transport } from "./settings";

/** 合成结果。 */
export interface SynthResult {
  /** 写入的绝对路径（失败时为空）。 */
  path?: string;
  /** 覆盖前备份到的路径（仅当原文件不是本插件生成时）。 */
  backup?: string;
  /** 人类可读的失败原因。 */
  error?: string;
  /** 还缺哪些必填设置（用户能照着去填）。 */
  missing?: string[];
}

/** 上传所需的设置值。 */
export interface DeployValues {
  host: string;
  port: number;
  user: string;
  remoteRoot: string;
  localRoot: string;
  transport: Transport;
  strictHostKey: boolean;
}

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bdl");
}

/** 读出当前设置（缺省值来自 package.json；transport 含旧键兼容）。 */
export function readDeployValues(): DeployValues {
  const c = cfg();
  const str = (key: string, def = ""): string => {
    const v = c.get<string>(key);
    return typeof v === "string" ? v.trim() : def;
  };
  return {
    host: str("prod.deploy.host"),
    port: c.get<number>("prod.deploy.port") ?? 22,
    user: str("prod.deploy.user"),
    remoteRoot: str("prod.deploy.remoteRoot"),
    localRoot: str("prod.deploy.localRoot", "."),
    transport: transport(),
    strictHostKey: c.get<boolean>("prod.deploy.strictHostKey") ?? true,
  };
}

/** 必填项是否齐了（缺了就没法上传，要明确告诉用户去哪填）。 */
export function missingDeploySettings(v: DeployValues): string[] {
  const missing: string[] = [];
  if (!v.host) {
    missing.push("账号、生产环境、配置 → 生产服务器：主机（host）");
  }
  if (!v.user) {
    missing.push("账号、生产环境、配置 → 生产服务器：SSH 用户名（user）");
  }
  if (!v.remoteRoot) {
    missing.push("上传编译链接 → 生产根目录（remoteRoot）");
  }
  return missing;
}

/**
 * 把设置合成为 `<root>/.project/deploy/deploy.json` 并返回路径。
 *
 * 只生成一个目标 `prod`（单文件上传，不做多目标）。
 */
export async function ensureDeployConfig(
  root: string,
  version: string,
): Promise<SynthResult> {
  const v = readDeployValues();
  if (v.transport === "off") {
    return {
      error:
        "上传未启用：请到设置「上传编译链接」把「上传方式」从「不上传」改为 rsync 或 scp",
    };
  }
  const missing = missingDeploySettings(v);
  if (missing.length > 0) {
    return {
      error: `上传需要先配置：${missing.join("；")}`,
      missing,
    };
  }

  const mode = v.transport === "scp" ? "scp" : "rsync";
  const targetObj: Record<string, unknown> = {
    host: v.host,
    user: v.user,
    remoteRoot: v.remoteRoot,
    localRoot: v.localRoot || ".",
    // 单文件上传：rsync 失败回退 scp；scp 模式下不回退（fallback 必须填 none）。
    upload: { mode, fallback: mode === "scp" ? "none" : "scp" },
    strictHostKey: v.strictHostKey,
  };
  if (v.port && v.port !== 22) {
    targetObj.port = v.port;
  }

  const doc = {
    // 标记 + 版本：一眼能看出"这份文件是插件生成的"，手改会在下次上传时被覆盖。
    createdBy: `vscode-bdl ${version}`,
    generatedAt: new Date().toISOString(),
    doc:
      "由 VSCode 插件根据「账号、生产环境、配置」与「上传编译链接」设置生成；" +
      "只上传当前文件（不做批量同步）。请改设置，不要手改本文件。",
    defaultTarget: "prod",
    targets: { prod: targetObj },
  };

  const dest = path.join(root, ".project", "deploy", "deploy.json");
  let backup: string | undefined;
  try {
    const raw = await fs.readFile(dest, "utf8");
    const old = JSON.parse(raw) as { createdBy?: string };
    if (!old || typeof old.createdBy !== "string") {
      // 不是我们生成的：备份一次再覆盖。
      backup = `${dest}.bak`;
      await fs.writeFile(backup, raw, "utf8");
    }
  } catch {
    // 不存在或不是 JSON：直接写（不是 JSON 的文件同样备份）
    try {
      const raw = await fs.readFile(dest, "utf8");
      backup = `${dest}.bak`;
      await fs.writeFile(backup, raw, "utf8");
    } catch {
      // 文件不存在，正常情况
    }
  }

  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  } catch (err) {
    return {
      error: `写 ${dest} 失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { path: dest, backup };
}
