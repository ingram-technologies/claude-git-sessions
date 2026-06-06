import { SESSIONS_DIR } from "./constants.js";
import { lsSessions, showFile } from "./git.js";
import { parseMeta, type SessionMeta } from "./meta.js";

export interface BranchSession {
  id: string;
  meta: SessionMeta | null;
}

/** Session ids present on the branch ref (derived from `.jsonl` blobs). */
export async function listBranchSessionIds(repo: string, ref: string): Promise<string[]> {
  const paths = await lsSessions(repo, ref);
  const ids = new Set<string>();
  for (const p of paths) {
    const m = p.match(new RegExp(`^${SESSIONS_DIR}/([^/]+)\\.jsonl$`));
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/** Read every session id + its parsed sidecar meta from the branch ref. */
export async function listBranchSessions(repo: string, ref: string): Promise<BranchSession[]> {
  const ids = await listBranchSessionIds(repo, ref);
  const out: BranchSession[] = [];
  for (const id of ids) {
    const raw = await showFile(repo, ref, `${SESSIONS_DIR}/${id}.meta.json`);
    let meta: SessionMeta | null = null;
    if (raw) {
      try {
        meta = parseMeta(raw);
      } catch {
        meta = null;
      }
    }
    out.push({ id, meta });
  }
  return out;
}
