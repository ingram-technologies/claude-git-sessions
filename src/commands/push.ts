import { SESSIONS_DIR } from "../constants.js";
import {
  applyToOrphanBranch,
  assertRemote,
  fetchBranch,
  localTrackingRef,
  showFile,
  validateBranchName,
} from "../git.js";
import { listBranchSessionIds } from "../branch-sessions.js";
import { discoverLocalSessions, type LocalSession } from "../discover.js";
import { buildMeta, gitAuthor, serializeMeta } from "../meta.js";
import { resolveTarget, shortId, type Candidate } from "../match.js";

export interface PushOptions {
  repoRoot: string;
  remote: string;
  branch: string;
  /** Optional id/name filters; empty => push all. */
  filters: string[];
}

export async function push(opts: PushOptions): Promise<number> {
  await validateBranchName(opts.repoRoot, opts.branch);
  await assertRemote(opts.repoRoot, opts.remote);

  let sessions = discoverLocalSessions(opts.repoRoot);
  if (sessions.length === 0) {
    console.log("nothing to push (no local sessions found for this repo)");
    return 0;
  }

  // Apply positional id/name filters if any were given.
  if (opts.filters.length > 0) {
    const candidates: (Candidate & { session: LocalSession })[] = sessions.map((s) => ({
      id: s.info.id,
      name: s.info.displayName,
      session: s,
    }));
    const selected = new Map<string, LocalSession>();
    for (const f of opts.filters) {
      const res = resolveTarget(f, candidates);
      if (res.kind === "match") {
        selected.set(res.item.id, res.item.session);
      } else if (res.kind === "ambiguous") {
        console.error(`"${f}" is ambiguous; matches:`);
        for (const c of res.items) console.error(`  ${shortId(c.id)}  ${c.name}`);
        return 1;
      } else {
        console.error(`"${f}" matched no local session for this repo`);
        return 1;
      }
    }
    sessions = [...selected.values()];
  }

  // Pre-compute what already exists on the branch so we can label each session
  // as added / updated / unchanged by comparing the transcript blob.
  await fetchBranch(opts.repoRoot, opts.remote, opts.branch);
  const ref = localTrackingRef(opts.branch);
  const existing = new Set(await listBranchSessionIds(opts.repoRoot, ref).catch(() => []));

  const author = await gitAuthor(opts.repoRoot);
  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;

  for (const s of sessions) {
    const label = `${s.info.displayName} (${shortId(s.info.id)})`;
    if (!existing.has(s.info.id)) {
      added.push(label);
    } else {
      const prev = await showFile(opts.repoRoot, ref, `${SESSIONS_DIR}/${s.info.id}.jsonl`);
      if (prev === s.content) unchanged++;
      else updated.push(label);
    }
  }

  const result = await applyToOrphanBranch(
    opts.repoRoot,
    opts.remote,
    opts.branch,
    buildCommitMessage(added.length + updated.length),
    async (b) => {
      for (const s of sessions) {
        const meta = buildMeta(s.info, opts.repoRoot, author);
        await b.addBlob(`${SESSIONS_DIR}/${s.info.id}.jsonl`, s.content);
        await b.addBlob(`${SESSIONS_DIR}/${s.info.id}.meta.json`, serializeMeta(meta));
      }
    },
  );

  if (!result.changed) {
    console.log(`Already up to date — ${unchanged} session(s) unchanged.`);
    return 0;
  }

  if (added.length) {
    console.log(`Added ${added.length}:`);
    for (const a of added) console.log(`  + ${a}`);
  }
  if (updated.length) {
    console.log(`Updated ${updated.length}:`);
    for (const u of updated) console.log(`  ~ ${u}`);
  }
  if (unchanged) console.log(`(${unchanged} unchanged)`);
  console.log(`Pushed to ${opts.remote} @ccgs/${opts.branch}.`);
  return 0;
}

function buildCommitMessage(n: number): string {
  return `ccgs: push ${n} session(s)`;
}
