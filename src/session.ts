import { DISPLAY_NAME_MAX } from "./constants.js";

/**
 * What we extract from a session `.jsonl` without forcing callers to re-parse
 * the whole transcript.
 *
 * Schema notes (verified 2026-06 against real Claude Code session files):
 * - The file is JSONL: one JSON object per line, many object `type`s
 *   (`user`, `assistant`, `attachment`, `ai-title`, `mode`, `summary`, ...).
 * - `sessionId` appears on most lines and equals the filename UUID.
 * - A human/AI title lives on a `{type:"ai-title", aiTitle:"..."}` line.
 *   Older versions used `{type:"summary", summary:"..."}`. Some objects also
 *   carry a `title` field. We check all of these.
 * - The working directory is the `cwd` field, present on `user`/`assistant`/
 *   `attachment` lines. This is the only field we remap on pull.
 * - Per-line `timestamp` is ISO-8601. `updatedAt` is the max across lines.
 * - The first user prompt is `message.content` on the first `type:"user"` line.
 *   `content` is either a string or an array of content blocks (each block may
 *   have a `.text`).
 */
export interface SessionInfo {
  id: string;
  /** Working dir recorded in the file (most recent line that carries one). */
  cwd: string | null;
  /** Resolved display name (title | summary | first user message | id). */
  displayName: string;
  /** Count of user + assistant message lines. */
  messageCount: number;
  /** ISO timestamp of last activity (max line timestamp, or null if none). */
  updatedAt: string | null;
}

interface ParsedLine {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  title?: string;
  aiTitle?: string;
  summary?: string;
  message?: { role?: string; content?: unknown };
  [k: string]: unknown;
}

function safeParse(line: string): ParsedLine | null {
  if (!line) return null;
  try {
    return JSON.parse(line) as ParsedLine;
  } catch {
    return null;
  }
}

/** Collapse whitespace and truncate for a tidy one-line display name. */
export function truncateName(s: string, max = DISPLAY_NAME_MAX): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

/** Pull plain text out of a user message `content` (string or block array). */
function userMessageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && typeof (block as any).text === "string") {
        return (block as any).text as string;
      }
    }
  }
  return null;
}

/**
 * Parse a session `.jsonl` body into a {@link SessionInfo}. `fallbackId` (the
 * filename UUID) is used when no line carries a `sessionId`.
 */
export function parseSession(content: string, fallbackId: string): SessionInfo {
  const lines = content.split("\n");

  let id: string | null = null;
  let cwd: string | null = null;
  let title: string | null = null;
  let summary: string | null = null;
  let firstUserText: string | null = null;
  let messageCount = 0;
  let updatedAt: string | null = null;

  for (const raw of lines) {
    const obj = safeParse(raw);
    if (!obj) continue;

    if (!id && typeof obj.sessionId === "string") id = obj.sessionId;

    // Track the most recent cwd we see (later lines win).
    if (typeof obj.cwd === "string" && obj.cwd) cwd = obj.cwd;

    if (typeof obj.timestamp === "string") {
      if (!updatedAt || obj.timestamp > updatedAt) updatedAt = obj.timestamp;
    }

    if (!title) {
      if (typeof obj.aiTitle === "string" && obj.aiTitle.trim()) title = obj.aiTitle;
      else if (obj.type === "summary" && typeof obj.summary === "string" && obj.summary.trim())
        summary = obj.summary;
      else if (typeof obj.title === "string" && obj.title.trim()) title = obj.title;
    }

    if (obj.type === "user" || obj.type === "assistant") messageCount++;

    if (firstUserText === null && obj.type === "user" && obj.message) {
      const t = userMessageText(obj.message.content);
      if (t && t.trim()) firstUserText = t;
    }
  }

  // Display name resolution order: title -> summary -> first user msg -> id.
  const resolvedId = id ?? fallbackId;
  let displayName: string;
  if (title) displayName = truncateName(title);
  else if (summary) displayName = truncateName(summary);
  else if (firstUserText) displayName = truncateName(firstUserText);
  else displayName = resolvedId;

  return { id: resolvedId, cwd, displayName, messageCount, updatedAt };
}

/**
 * Rewrite the structural `cwd` field from `fromCwd` to `toCwd` on every line
 * whose parsed `cwd` exactly equals `fromCwd`.
 *
 * We deliberately do a TARGETED replacement of just the `"cwd":"..."` token
 * (located by JSON-encoding the values) rather than a blind find-and-replace or
 * a full re-serialize: this preserves every other byte of the transcript
 * exactly, avoiding any risk of corrupting message/tool-output content that may
 * happen to contain the same path string.
 */
export function remapCwd(content: string, fromCwd: string, toCwd: string): string {
  if (fromCwd === toCwd) return content;
  const fromToken = `"cwd":${JSON.stringify(fromCwd)}`;
  const toToken = `"cwd":${JSON.stringify(toCwd)}`;

  return content
    .split("\n")
    .map((line) => {
      const obj = safeParse(line);
      if (obj && typeof obj.cwd === "string" && obj.cwd === fromCwd) {
        // Replace only the first occurrence (the structural field); any path in
        // free-text content is left untouched.
        return line.replace(fromToken, toToken);
      }
      return line;
    })
    .join("\n");
}
