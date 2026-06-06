import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { SESSIONS_DIR } from "../constants.js";
import {
  applyToOrphanBranch,
  assertRemote,
  fetchBranch,
  localTrackingRef,
  validateBranchName,
} from "../git.js";
import { listBranchSessions } from "../branch-sessions.js";
import { resolveTarget, shortId, type Candidate } from "../match.js";
import { sessionFilePath } from "../paths.js";
import type { SessionMeta } from "../meta.js";

export interface DeleteOptions {
  repoRoot: string;
  remote: string;
  branch: string;
  target: string;
  yes: boolean;
  local: boolean;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function deleteSession(opts: DeleteOptions): Promise<number> {
  await validateBranchName(opts.repoRoot, opts.branch);
  await assertRemote(opts.repoRoot, opts.remote);

  const exists = await fetchBranch(opts.repoRoot, opts.remote, opts.branch);
  if (!exists) {
    console.log("nothing to delete (branch does not exist on remote)");
    return 0;
  }

  const ref = localTrackingRef(opts.branch);
  const sessions = await listBranchSessions(opts.repoRoot, ref);
  if (sessions.length === 0) {
    console.log("nothing to delete (no sessions on branch)");
    return 0;
  }

  const candidates: (Candidate & { meta: SessionMeta | null })[] = sessions.map((s) => ({
    id: s.id,
    name: s.meta?.name ?? s.id,
    meta: s.meta,
  }));

  const res = resolveTarget(opts.target, candidates);
  if (res.kind === "none") {
    console.error(`"${opts.target}" matched no session on @ccgs/${opts.branch}`);
    return 1;
  }
  if (res.kind === "ambiguous") {
    console.error(`"${opts.target}" is ambiguous; candidates:`);
    for (const c of res.items) console.error(`  ${shortId(c.id)}  ${c.name}`);
    console.error("Refine your query (use a longer id prefix or exact name).");
    return 1;
  }

  const item = res.item;
  const meta = item.meta;
  console.log("Will delete:");
  console.log(`  id:        ${item.id}`);
  console.log(`  name:      ${meta?.name ?? "(unknown)"}`);
  console.log(`  author:    ${meta?.author ?? "(unknown)"}`);
  console.log(`  updatedAt: ${meta?.updatedAt ?? "(unknown)"}`);

  if (!opts.yes) {
    const ok = await confirm(`Delete this session from @ccgs/${opts.branch}? [y/N] `);
    if (!ok) {
      console.log("Aborted.");
      return 0;
    }
  }

  const result = await applyToOrphanBranch(
    opts.repoRoot,
    opts.remote,
    opts.branch,
    `ccgs: delete session ${shortId(item.id)}`,
    async (b) => {
      await b.removeBlob(`${SESSIONS_DIR}/${item.id}.jsonl`);
      await b.removeBlob(`${SESSIONS_DIR}/${item.id}.meta.json`);
    },
  );

  if (result.changed) {
    console.log(`Deleted ${item.name} (${shortId(item.id)}) from ${opts.remote} @ccgs/${opts.branch}.`);
  } else {
    console.log("Nothing changed on the branch (already absent).");
  }

  if (opts.local) {
    const rel = meta?.cwdRelativeToRepoRoot ?? "";
    const localCwd = rel ? path.join(opts.repoRoot, rel) : opts.repoRoot;
    const localFile = sessionFilePath(localCwd, item.id);
    if (fs.existsSync(localFile)) {
      fs.rmSync(localFile);
      console.log(`Removed local copy: ${localFile}`);
    } else {
      console.log("No local copy found to remove.");
    }
  }

  return 0;
}
