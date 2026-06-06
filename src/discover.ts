import fs from "node:fs";
import path from "node:path";
import { projectsDir } from "./paths.js";
import { parseSession, type SessionInfo } from "./session.js";

export interface LocalSession {
  info: SessionInfo;
  /** Absolute path to the local `.jsonl`. */
  file: string;
  /** Raw transcript content (read once, reused for push). */
  content: string;
}

/** Is `child` the same as, or nested under, `parent`? */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Find local Claude Code sessions belonging to `repoRoot`.
 *
 * Sessions launched at the repo root live under the repo-root slug, but a
 * session launched in a subdirectory lives under a *different* slug. So rather
 * than rely on the slug alone, we scan every project directory, read each
 * transcript, and keep the ones whose recorded `cwd` is the repo root or nested
 * within it. The recorded cwd also gives us `cwdRelativeToRepoRoot` for free.
 */
export function discoverLocalSessions(repoRoot: string): LocalSession[] {
  const root = projectsDir();
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // no ~/.claude/projects yet
  }

  const found: LocalSession[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dirPath, f);
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const fallbackId = f.replace(/\.jsonl$/, "");
      const info = parseSession(content, fallbackId);
      if (info.cwd && isWithin(repoRoot, info.cwd)) {
        found.push({ info, file, content });
      }
    }
  }
  return found;
}
