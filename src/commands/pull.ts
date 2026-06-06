import fs from "node:fs";
import path from "node:path";
import { SESSIONS_DIR } from "../constants.js";
import {
  assertRemote,
  fetchBranch,
  localTrackingRef,
  showFile,
  validateBranchName,
} from "../git.js";
import { listBranchSessions } from "../branch-sessions.js";
import { parseSession, remapCwd } from "../session.js";
import { projectDirForCwd, sessionFilePath } from "../paths.js";
import { shortId } from "../match.js";

export interface PullOptions {
  repoRoot: string;
  remote: string;
  branch: string;
  force: boolean;
}

export async function pull(opts: PullOptions): Promise<number> {
  await validateBranchName(opts.repoRoot, opts.branch);
  await assertRemote(opts.repoRoot, opts.remote);

  const exists = await fetchBranch(opts.repoRoot, opts.remote, opts.branch);
  if (!exists) {
    console.log("nothing to pull (branch does not exist on remote)");
    return 0;
  }

  const ref = localTrackingRef(opts.branch);
  const sessions = await listBranchSessions(opts.repoRoot, ref);
  if (sessions.length === 0) {
    console.log("nothing to pull (no sessions on branch)");
    return 0;
  }

  const pulled: string[] = [];
  const skipped: string[] = [];

  for (const { id, meta } of sessions) {
    const jsonl = await showFile(opts.repoRoot, ref, `${SESSIONS_DIR}/${id}.jsonl`);
    if (jsonl === null) {
      skipped.push(`${shortId(id)}: missing transcript blob`);
      continue;
    }

    // Reconstruct the local cwd for this session: repo root + recorded subdir.
    const rel = meta?.cwdRelativeToRepoRoot ?? "";
    const localCwd = rel ? path.join(opts.repoRoot, rel) : opts.repoRoot;
    const name = meta?.name ?? id;

    // Conflict policy: newer local copy is kept unless --force.
    const localFile = sessionFilePath(localCwd, id);
    if (!opts.force && fs.existsSync(localFile)) {
      const branchUpdated = meta?.updatedAt ?? "";
      const localInfo = parseSession(fs.readFileSync(localFile, "utf8"), id);
      const localUpdated = localInfo.updatedAt ?? "";
      if (localUpdated && branchUpdated && localUpdated > branchUpdated) {
        skipped.push(`${name} (${shortId(id)}): local copy is newer (use --force)`);
        continue;
      }
    }

    // Remap the structural cwd from the author's path to ours.
    const remapped = meta?.originalCwd
      ? remapCwd(jsonl, meta.originalCwd, localCwd)
      : jsonl;

    const dir = projectDirForCwd(localCwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFile, remapped);
    pulled.push(`${name} (${shortId(id)})`);
  }

  if (pulled.length) {
    console.log(`Pulled ${pulled.length} session(s):`);
    for (const p of pulled) console.log(`  + ${p}`);
  } else {
    console.log("Pulled 0 sessions.");
  }
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  return 0;
}
