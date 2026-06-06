import os from "node:os";
import path from "node:path";
import { gitOut } from "./git.js";
import type { SessionInfo } from "./session.js";

/**
 * Sidecar metadata stored next to each transcript on the orphan branch as
 * `sessions/<id>.meta.json`. It lets `push` output, `pull` listing and
 * `delete`-by-name work without re-parsing large transcripts.
 */
export interface SessionMeta {
  id: string;
  name: string;
  /** Absolute cwd on the author's machine. */
  originalCwd: string;
  /** Usually "" ; the subdir if claude was run below the repo root. */
  cwdRelativeToRepoRoot: string;
  author: string;
  machine: string;
  messageCount: number;
  /** ISO timestamp, from the session file's last activity. */
  updatedAt: string;
}

/** "Name <email>" from git config, best-effort. */
export async function gitAuthor(repoRoot: string): Promise<string> {
  const name = (await gitOut(["config", "user.name"], { cwd: repoRoot, allowFail: true })).trim();
  const email = (await gitOut(["config", "user.email"], { cwd: repoRoot, allowFail: true })).trim();
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return "unknown";
}

/**
 * Build the sidecar metadata for a local session being pushed.
 * `cwdRelativeToRepoRoot` is derived from the session's recorded cwd relative
 * to the local repo root (POSIX-style, "" when at the root).
 */
export function buildMeta(
  info: SessionInfo,
  repoRoot: string,
  author: string,
): SessionMeta {
  const originalCwd = info.cwd ?? repoRoot;
  let rel = path.relative(repoRoot, originalCwd);
  if (rel === "" || rel === ".") rel = "";
  // Normalize to forward slashes so it round-trips across platforms.
  rel = rel.split(path.sep).join("/");
  return {
    id: info.id,
    name: info.displayName,
    originalCwd,
    cwdRelativeToRepoRoot: rel,
    author,
    machine: os.hostname(),
    messageCount: info.messageCount,
    updatedAt: info.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeMeta(meta: SessionMeta): string {
  return JSON.stringify(meta, null, 2) + "\n";
}

export function parseMeta(raw: string): SessionMeta {
  return JSON.parse(raw) as SessionMeta;
}
