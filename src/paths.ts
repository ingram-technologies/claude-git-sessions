import os from "node:os";
import path from "node:path";
import { pathToProjectSlug } from "./slug.js";

/**
 * Root of the Claude Code config, honoring `CLAUDE_CONFIG_DIR` and falling back
 * to `~/.claude`.
 */
export function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim() !== "") return override;
  return path.join(os.homedir(), ".claude");
}

/** `<config>/projects` — the directory holding one slug subdir per project. */
export function projectsDir(): string {
  return path.join(claudeConfigDir(), "projects");
}

/** Absolute project directory Claude Code uses for sessions launched in `absCwd`. */
export function projectDirForCwd(absCwd: string): string {
  return path.join(projectsDir(), pathToProjectSlug(absCwd));
}

/** Where a session `.jsonl` lives locally for a given cwd + id. */
export function sessionFilePath(absCwd: string, sessionId: string): string {
  return path.join(projectDirForCwd(absCwd), `${sessionId}.jsonl`);
}
