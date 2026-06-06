import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEMORY_DIR, MEMORY_INDEX } from "../constants.js";
import {
  applyToOrphanBranch,
  assertRemote,
  fetchBranch,
  localTrackingRef,
  lsTreeUnder,
  showFile,
  validateBranchName,
} from "../git.js";
import { gitAuthor } from "../meta.js";
import {
  indexLine,
  isShareable,
  memoryDir,
  parseFrontmatter,
  readLocalMemory,
  titleFor,
  updateIndexBlock,
  type MemoryType,
} from "../memory.js";

/** Sidecar stored next to each shared memory file on the branch. */
interface MemorySidecar {
  filename: string;
  type: MemoryType;
  name: string | null;
  description: string | null;
  author: string;
  machine: string;
  updatedAt: string;
}

export interface MemoryPushOptions {
  repoRoot: string;
  remote: string;
  branch: string;
  all: boolean;
}

export interface MemoryPullOptions {
  repoRoot: string;
  remote: string;
  branch: string;
  all: boolean;
  force: boolean;
}

function metaPath(filename: string): string {
  return `${MEMORY_DIR}/${filename}.meta.json`;
}
function blobPath(filename: string): string {
  return `${MEMORY_DIR}/${filename}`;
}

/** Filenames of `.md` memory facts on the branch (excludes sidecars). */
async function listBranchMemory(repo: string, ref: string): Promise<string[]> {
  const paths = await lsTreeUnder(repo, ref, MEMORY_DIR);
  const names = new Set<string>();
  for (const p of paths) {
    const m = p.match(new RegExp(`^${MEMORY_DIR}/(.+\\.md)$`));
    if (m && m[1] !== MEMORY_INDEX) names.add(m[1]);
  }
  return [...names];
}

export async function memoryPush(opts: MemoryPushOptions): Promise<number> {
  await validateBranchName(opts.repoRoot, opts.branch);
  await assertRemote(opts.repoRoot, opts.remote);

  const all = readLocalMemory(opts.repoRoot);
  const shareable = all.filter((f) => isShareable(f.type, opts.all));
  const heldBack = all.length - shareable.length;

  if (shareable.length === 0) {
    const extra = heldBack
      ? ` (${heldBack} personal user/feedback memo(ies) held back; use --all to include)`
      : "";
    console.log(`nothing to push (no shareable memory found for this repo)${extra}`);
    return 0;
  }

  await fetchBranch(opts.repoRoot, opts.remote, opts.branch);
  const ref = localTrackingRef(opts.branch);
  const existing = new Set(await listBranchMemory(opts.repoRoot, ref).catch(() => []));

  const author = await gitAuthor(opts.repoRoot);
  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;

  for (const f of shareable) {
    if (!existing.has(f.filename)) {
      added.push(f.filename);
    } else {
      const prev = await showFile(opts.repoRoot, ref, blobPath(f.filename));
      if (prev === f.content) unchanged++;
      else updated.push(f.filename);
    }
  }

  const result = await applyToOrphanBranch(
    opts.repoRoot,
    opts.remote,
    opts.branch,
    `ccgs: push ${added.length + updated.length} memory file(s)`,
    async (b) => {
      for (const f of shareable) {
        const sidecar: MemorySidecar = {
          filename: f.filename,
          type: f.type,
          name: f.name,
          description: f.description,
          author,
          machine: os.hostname(),
          updatedAt: f.updatedAt,
        };
        await b.addBlob(blobPath(f.filename), f.content);
        await b.addBlob(metaPath(f.filename), JSON.stringify(sidecar, null, 2) + "\n");
      }
    },
  );

  if (!result.changed) {
    console.log(`Memory already up to date — ${unchanged} file(s) unchanged.`);
    if (heldBack) console.log(`(${heldBack} personal memo(ies) held back; --all to include)`);
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
  if (heldBack) console.log(`(${heldBack} personal user/feedback memo(ies) held back; --all to include)`);
  console.log(`Pushed memory to ${opts.remote} @ccgs/${opts.branch}.`);
  return 0;
}

export async function memoryPull(opts: MemoryPullOptions): Promise<number> {
  await validateBranchName(opts.repoRoot, opts.branch);
  await assertRemote(opts.repoRoot, opts.remote);

  const exists = await fetchBranch(opts.repoRoot, opts.remote, opts.branch);
  if (!exists) {
    console.log("nothing to pull (branch does not exist on remote)");
    return 0;
  }

  const ref = localTrackingRef(opts.branch);
  const filenames = await listBranchMemory(opts.repoRoot, ref);
  if (filenames.length === 0) {
    console.log("nothing to pull (no shared memory on branch)");
    return 0;
  }

  const dir = memoryDir(opts.repoRoot);
  const pulled: string[] = [];
  const skipped: string[] = [];
  // Files present locally after this pull, for index regeneration.
  const indexEntries: { filename: string; description: string | null; title: string }[] = [];

  for (const filename of filenames) {
    const content = await showFile(opts.repoRoot, ref, blobPath(filename));
    if (content === null) {
      skipped.push(`${filename}: missing blob`);
      continue;
    }
    const rawMeta = await showFile(opts.repoRoot, ref, metaPath(filename));
    let sidecar: MemorySidecar | null = null;
    if (rawMeta) {
      try {
        sidecar = JSON.parse(rawMeta) as MemorySidecar;
      } catch {
        sidecar = null;
      }
    }

    const type: MemoryType = sidecar?.type ?? parseFrontmatter(content).type;
    // Apply the same type gate on pull: don't litter local memory with other
    // people's personal facts unless explicitly asked.
    if (!isShareable(type, opts.all)) {
      continue;
    }

    const description = sidecar?.description ?? parseFrontmatter(content).description;
    const localFile = path.join(dir, filename);

    // Conflict policy: keep a newer local copy unless --force.
    if (!opts.force && fs.existsSync(localFile)) {
      const branchUpdated = sidecar?.updatedAt ?? "";
      const localUpdated = fs.statSync(localFile).mtime.toISOString();
      if (branchUpdated && localUpdated > branchUpdated) {
        skipped.push(`${filename}: local copy is newer (use --force)`);
        // Still index it — the file exists locally and is part of the shared set.
        indexEntries.push({ filename, description, title: titleFor({ filename, name: sidecar?.name ?? null }) });
        continue;
      }
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFile, content);
    pulled.push(filename);
    indexEntries.push({ filename, description, title: titleFor({ filename, name: sidecar?.name ?? null }) });
  }

  // Rebuild the ccgs-managed block in MEMORY.md from the shared set.
  if (indexEntries.length) {
    const indexPath = path.join(dir, MEMORY_INDEX);
    let existing = "";
    try {
      existing = fs.readFileSync(indexPath, "utf8");
    } catch {
      existing = "";
    }
    const lines = indexEntries
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((e) => indexLine(e));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexPath, updateIndexBlock(existing, lines));
  }

  if (pulled.length) {
    console.log(`Pulled ${pulled.length} memory file(s):`);
    for (const p of pulled) console.log(`  + ${p}`);
    console.log(`Index updated: ${path.join(dir, MEMORY_INDEX)}`);
  } else {
    console.log("Pulled 0 memory files.");
  }
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  return 0;
}
