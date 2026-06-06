import fs from "node:fs";
import path from "node:path";
import { MEMORY_DIR, MEMORY_INDEX } from "./constants.js";
import { projectDirForCwd } from "./paths.js";

/**
 * Claude Code's file-based memory lives at
 * `~/.claude/projects/<slug>/memory/` as one Markdown file per fact, plus a
 * hand-maintained `MEMORY.md` index loaded into context each session. Each fact
 * file carries YAML-ish frontmatter:
 *
 *   ---
 *   name: <kebab-slug>
 *   description: <one-line summary>
 *   metadata:
 *     type: user | feedback | project | reference
 *   ---
 *   <body>
 *
 * ccgs shares these the same way it shares sessions (same orphan branch, under a
 * `memory/` prefix), but with two differences that matter:
 *
 *  - It filters by `type`. `project`/`reference` facts are team knowledge and
 *    are shared by default; `user`/`feedback` facts are personal and are only
 *    shared with `--all`.
 *  - `MEMORY.md` is NOT synced as a blob (two authors' indexes would clobber
 *    each other). Instead, on pull, ccgs maintains a clearly-marked block inside
 *    the local `MEMORY.md` with pointers to the shared facts, leaving your own
 *    index lines untouched.
 */

export type MemoryType = "user" | "feedback" | "project" | "reference" | "unknown";
const KNOWN_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

export interface MemoryFile {
  /** Bare filename, e.g. "deploy-process.md". */
  filename: string;
  /** Absolute local path. */
  path: string;
  content: string;
  name: string | null;
  description: string | null;
  type: MemoryType;
  /** ISO timestamp derived from the file's mtime. */
  updatedAt: string;
}

/** Local memory directory for the repo's root slug. */
export function memoryDir(repoRoot: string): string {
  return path.join(projectDirForCwd(repoRoot), MEMORY_DIR);
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Minimal frontmatter reader for the known memory format. Deliberately not a
 * full YAML parser — it only pulls out `name`, `description`, and the nested
 * `type`, and degrades gracefully (type "unknown") on anything unexpected.
 */
export function parseFrontmatter(content: string): {
  name: string | null;
  description: string | null;
  type: MemoryType;
} {
  let name: string | null = null;
  let description: string | null = null;
  let type: MemoryType = "unknown";

  if (content.startsWith("---")) {
    // Find the closing delimiter line.
    const rest = content.slice(3);
    const endIdx = rest.search(/\n---\s*(\n|$)/);
    if (endIdx !== -1) {
      const block = rest.slice(0, endIdx);
      for (const line of block.split("\n")) {
        const n = line.match(/^\s*name:\s*(.+?)\s*$/);
        if (n && name === null) name = stripQuotes(n[1]);
        const d = line.match(/^\s*description:\s*(.+?)\s*$/);
        if (d && description === null) description = stripQuotes(d[1]);
        const t = line.match(/^\s*type:\s*([A-Za-z]+)/);
        if (t) {
          const v = t[1].toLowerCase() as MemoryType;
          if (KNOWN_TYPES.includes(v)) type = v;
        }
      }
    }
  }
  return { name, description, type };
}

/** Should a fact of `type` be shared? `all` overrides the type filter. */
export function isShareable(type: MemoryType, all: boolean): boolean {
  if (all) return true;
  return type === "project" || type === "reference";
}

/** kebab-or-filename -> a human "Title Case" string for the index link text. */
export function titleFor(file: { filename: string; name: string | null }): string {
  const base = file.name ?? file.filename.replace(/\.md$/i, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read all shareable-candidate memory files from the repo's memory dir. */
export function readLocalMemory(repoRoot: string): MemoryFile[] {
  const dir = memoryDir(repoRoot);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: MemoryFile[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".md")) continue;
    if (filename === MEMORY_INDEX) continue; // index handled separately
    const p = path.join(dir, filename);
    let content: string;
    let mtime: Date;
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      mtime = st.mtime;
      content = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    out.push({
      filename,
      path: p,
      content,
      name: fm.name,
      description: fm.description,
      type: fm.type,
      updatedAt: mtime.toISOString(),
    });
  }
  return out;
}

const BLOCK_START = "<!-- ccgs:shared-memory (managed by ccgs; do not edit by hand) -->";
const BLOCK_END = "<!-- /ccgs:shared-memory -->";

/** One index pointer line: `- [Title](file.md) — description`. */
export function indexLine(file: { filename: string; description: string | null; title: string }): string {
  const tail = file.description ? ` — ${file.description}` : "";
  return `- [${file.title}](${file.filename})${tail}`;
}

/**
 * Replace (or append) the ccgs-managed block in a MEMORY.md body with the given
 * lines, leaving everything outside the markers untouched. Returns the new body.
 */
export function updateIndexBlock(existing: string, lines: string[]): string {
  const block = lines.length
    ? `${BLOCK_START}\n${lines.join("\n")}\n${BLOCK_END}`
    : `${BLOCK_START}\n${BLOCK_END}`;

  const startIdx = existing.indexOf(BLOCK_START);
  const endIdx = existing.indexOf(BLOCK_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + BLOCK_END.length);
    return before + block + after;
  }

  // Append, ensuring a blank line separates it from existing content.
  const base = existing.trimEnd();
  if (base === "") return block + "\n";
  return `${base}\n\n${block}\n`;
}
