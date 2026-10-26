// 部署配置合成（P1-5/W6）：用户只改 VSCode 设置，插件是 `.project/deploy/deploy.json` 的
// **唯一写入者**——不再要求用户手写 JSON。
//
// 契约：tiptop 的配置模型（targets / upload / compile）不变，插件只是把
// 「生产环境 → 部署」那组设置翻译成同一份 JSON，然后 `tiptop deploy -config <文件>`。
//
// 安全：文件里只有主机名/账号/路径（没有密码），但仍建议不进 git（生产主机信息）。
// 不是本插件生成的文件（没有 `createdBy`）在覆盖前会备份成 `deploy.json.bak`。
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

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

/** 「生产环境 → 部署」这一组设置的值。 */
export interface DeployValues {
  host: string;
  port: number;
  user: string;
  remoteRoot: string;
  localRoot: string;
  transport: string;
  fallback: string;
  remove: boolean;
  include: string[];
  exclude: string[];
  strictHostKey: boolean;
  compile4gl: string;
  compilePer: string;
  target: string;
}

function cfg() {
  return vscode.workspace.getConfiguration("bdl");
}

/** 读出当前设置（缺省值来自 package.json）。 */
export function readDeployValues(): DeployValues {
  const c = cfg();
  const str = (key: string, def = ""): string => {
    const v = c.get<string>(key);
    return typeof v === "string" ? v.trim() : def;
  };
  const arr = (key: string): string[] => {
    const v = c.get<string[]>(key);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : [];
  };
  return {
    host: str("prod.deploy.host"),
    port: c.get<number>("prod.deploy.port") ?? 22,
    user: str("prod.deploy.user"),
    remoteRoot: str("prod.deploy.remoteRoot"),
    localRoot: str("prod.deploy.localRoot", "."),
    transport: str("prod.deploy.transport", "rsync"),
    fallback: str("prod.deploy.fallback", "scp"),
    remove: c.get<boolean>("prod.deploy.delete") ?? false,
    include: arr("prod.deploy.include"),
    exclude: arr("prod.deploy.exclude"),
    strictHostKey: c.get<boolean>("prod.deploy.strictHostKey") ?? true,
    compile4gl: str("prod.deploy.compile4gl"),
    compilePer: str("prod.deploy.compilePer"),
    target: (c.get<string>("deploy.target") ?? "").trim(),
  };
}

/** 必填项是否齐了（缺了就没法部署，要明确告诉用户去哪填）。 */
export function missingDeploySettings(v: DeployValues): string[] {
  const missing: string[] = [];
  if (!v.host) missing.push("生产环境 → 部署：主机（host）");
  if (!v.user) missing.push("生产环境 → 部署：SSH 用户名（user）");
  if (!v.remoteRoot) missing.push("生产环境 → 部署：远程工作根（remoteRoot）");
  return missing;
}

/** 目标名（`bdl.deploy.target` 留空时用 `default`）。 */
export function deployTargetName(v: DeployValues): string {
  return v.target || "default";
}

/**
 * 把设置合成为 `<root>/.project/deploy/deploy.json` 并返回路径（W6）。
 *
 * 已经存在且**不是**本插件生成的文件（例如历史手写的
 * `.project/deploy.json` / `.bdl-lsp/deploy.json` 被挪过来）会先备份成 `.bak`，
 * 避免用户的东西被无声覆盖。
 */
export async function ensureDeployConfig(
  root: string,
  version: string,
): Promise<SynthResult> {
  const v = readDeployValues();
  const missing = missingDeploySettings(v);
  if (missing.length > 0) {
    return {
      error: `部署需要先配置：${missing.join("；")}（设置里搜 “Genero BDL: 生产环境”）`,
      missing,
    };
  }

  const target = deployTargetName(v);
  const targetObj: Record<string, unknown> = {
    host: v.host,
    user: v.user,
    remoteRoot: v.remoteRoot,
    localRoot: v.localRoot || ".",
    upload: {
      mode: v.transport || "rsync",
      fallback: v.fallback || "scp",
      delete: v.remove,
      ...(v.include.length > 0 ? { include: v.include } : {}),
      ...(v.exclude.length > 0 ? { exclude: v.exclude } : {}),
    },
    strictHostKey: v.strictHostKey,
  };
  if (v.port && v.port !== 22) {
    targetObj.port = v.port;
  }
  const compile: Record<string, string> = {};
  if (v.compile4gl) compile["4gl"] = v.compile4gl;
  if (v.compilePer) compile["per"] = v.compilePer;
  if (Object.keys(compile).length > 0) {
    targetObj.compile = compile;
  }

  const doc = {
    // 标记 + 版本：一眼能看出"这份文件是插件生成的"，手改会在下次部署时被覆盖。
    createdBy: `vscode-bdl ${version}`,
    generatedAt: new Date().toISOString(),
    doc: "由 VSCode 插件根据「Genero BDL: 生产环境」设置生成；请改设置，不要手改本文件。",
    defaultTarget: target,
    targets: { [target]: targetObj },
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