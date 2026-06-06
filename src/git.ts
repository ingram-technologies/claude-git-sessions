import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRANCH_PREFIX, SESSIONS_DIR } from "./constants.js";

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  /** When true, never throw on a non-zero exit; the caller inspects `.code`. */
  allowFail?: boolean;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run git with an explicit argv (never a shell string) so no user input is ever
 * interpolated into a shell. stdout is captured as a Buffer then decoded utf-8.
 */
export function git(args: string[], opts: RunOpts = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      const result: GitResult = {
        code: code ?? 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      };
      if (result.code !== 0 && !opts.allowFail) {
        reject(
          new GitError(
            `git ${args.join(" ")} failed (exit ${result.code}): ${result.stderr.trim()}`,
            result.code,
            result.stderr,
          ),
        );
      } else {
        resolve(result);
      }
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Convenience: return trimmed stdout, throwing on failure unless allowFail. */
export async function gitOut(args: string[], opts: RunOpts = {}): Promise<string> {
  const r = await git(args, opts);
  return r.stdout;
}

/** Absolute repo root, or throw a clear error if not inside a git repo. */
export async function repoRoot(): Promise<string> {
  const r = await git(["rev-parse", "--show-toplevel"], { allowFail: true });
  if (r.code !== 0) {
    throw new Error("not inside a git repository (run ccgs from within your repo)");
  }
  return r.stdout.trim();
}

/** Full `@ccgs/<name>` branch name. */
export function branchName(name: string): string {
  return `${BRANCH_PREFIX}${name}`;
}
/** Local tracking ref we fetch the orphan branch into (kept out of refs/heads). */
export function localTrackingRef(name: string): string {
  return `refs/ccgs/${name}`;
}
/** Fully-qualified remote head ref we push to / fetch from. */
export function remoteHeadRef(name: string): string {
  return `refs/heads/${branchName(name)}`;
}

/** Validate the branch name with `git check-ref-format`; throw if invalid. */
export async function validateBranchName(repo: string, name: string): Promise<void> {
  const ref = remoteHeadRef(name);
  const r = await git(["check-ref-format", ref], { cwd: repo, allowFail: true });
  if (r.code !== 0) {
    throw new Error(
      `invalid branch name "${name}": "${ref}" is not a valid git ref`,
    );
  }
}

/** Error clearly if the named remote does not exist. */
export async function assertRemote(repo: string, remote: string): Promise<void> {
  const r = await git(["remote"], { cwd: repo });
  const remotes = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!remotes.includes(remote)) {
    throw new Error(
      `remote "${remote}" not found (configured remotes: ${remotes.join(", ") || "none"})`,
    );
  }
}

/**
 * Fetch the orphan branch from the remote into our local tracking ref.
 * Returns true if it exists remotely, false if the remote ref is absent.
 */
export async function fetchBranch(
  repo: string,
  remote: string,
  name: string,
): Promise<boolean> {
  const refspec = `+${remoteHeadRef(name)}:${localTrackingRef(name)}`;
  const r = await git(["fetch", "--no-tags", remote, refspec], {
    cwd: repo,
    allowFail: true,
  });
  if (r.code === 0) return true;
  // git reports a missing branch as "couldn't find remote ref ...".
  if (/couldn't find remote ref|couldn't find remote/i.test(r.stderr)) return false;
  throw new GitError(
    `failed to fetch ${branchName(name)} from ${remote}: ${r.stderr.trim()}`,
    r.code,
    r.stderr,
  );
}

/** SHA of the local tracking ref, or null if it does not exist. */
export async function trackingTip(repo: string, name: string): Promise<string | null> {
  const r = await git(["rev-parse", "--verify", "--quiet", localTrackingRef(name)], {
    cwd: repo,
    allowFail: true,
  });
  const sha = r.stdout.trim();
  return sha || null;
}

/** List `sessions/*` paths present on a tree-ish ref. */
export async function lsSessions(repo: string, ref: string): Promise<string[]> {
  const r = await git(["ls-tree", "-r", "--name-only", ref], { cwd: repo, allowFail: true });
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((p) => p.startsWith(`${SESSIONS_DIR}/`));
}

/** Read a blob at `ref:path` as utf-8 text, or null if it does not exist. */
export async function showFile(repo: string, ref: string, filePath: string): Promise<string | null> {
  const r = await git(["show", `${ref}:${filePath}`], { cwd: repo, allowFail: true });
  if (r.code !== 0) return null;
  return r.stdout;
}

/**
 * Mutations the caller wants to apply to the orphan branch's tree. The provided
 * helpers stage changes into a throwaway index (never the user's index).
 */
export interface TreeBuilder {
  /** Stage a blob at `gitPath` (content hashed verbatim into the object DB). */
  addBlob(gitPath: string, content: string | Buffer): Promise<void>;
  /** Remove `gitPath` from the tree (ignored if absent). */
  removeBlob(gitPath: string): Promise<void>;
}

export interface ApplyResult {
  /** True if the tree changed and a commit was pushed. */
  changed: boolean;
  /** New commit sha, when changed. */
  commit?: string;
}

const NONFF =
  /non-fast-forward|fetch first|\[rejected\]|cannot lock ref|failed to update ref|stale info/i;

/**
 * Build a new commit on the orphan branch and push it, WITHOUT touching the
 * user's working tree, index or current branch, and tolerating a dirty tree.
 *
 * Mechanics (pure plumbing):
 *   - work against a private temp index via GIT_INDEX_FILE
 *   - seed it from the current branch tip (or empty, for a true orphan root)
 *   - let `apply` hash-object/update-index the session blobs
 *   - write-tree -> commit-tree (-p parent, omitted => orphan root)
 *   - push <commit>:refs/heads/@ccgs/<name>
 * On a non-fast-forward rejection it re-fetches the tip and replays, a few times.
 */
export async function applyToOrphanBranch(
  repo: string,
  remote: string,
  name: string,
  message: string,
  apply: (b: TreeBuilder) => Promise<void>,
  maxRetries = 5,
): Promise<ApplyResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const exists = await fetchBranch(repo, remote, name);
    const parent = exists ? await trackingTip(repo, name) : null;

    const indexFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "ccgs-idx-")),
      "index",
    );
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: indexFile };

    try {
      // Seed the temp index from the parent tree (orphan root starts empty).
      if (parent) {
        await git(["read-tree", parent], { cwd: repo, env });
      }

      const builder: TreeBuilder = {
        async addBlob(gitPath, content) {
          const sha = (
            await gitOut(["hash-object", "-w", "--stdin"], { cwd: repo, input: content })
          ).trim();
          await git(
            ["update-index", "--add", "--cacheinfo", `100644,${sha},${gitPath}`],
            { cwd: repo, env },
          );
        },
        async removeBlob(gitPath) {
          await git(["update-index", "--force-remove", gitPath], { cwd: repo, env, allowFail: true });
        },
      };

      await apply(builder);

      const tree = (await gitOut(["write-tree"], { cwd: repo, env })).trim();

      // No-op short-circuit: identical to parent tree -> nothing to push.
      if (parent) {
        const parentTree = (
          await gitOut(["rev-parse", `${parent}^{tree}`], { cwd: repo })
        ).trim();
        if (tree === parentTree) return { changed: false };
      }

      const commitArgs = ["commit-tree", tree];
      if (parent) commitArgs.push("-p", parent);
      const commit = (
        await gitOut(commitArgs, { cwd: repo, input: message })
      ).trim();

      const push = await git(
        ["push", remote, `${commit}:${remoteHeadRef(name)}`],
        { cwd: repo, allowFail: true },
      );
      if (push.code === 0) return { changed: true, commit };

      if (NONFF.test(push.stderr) && attempt < maxRetries - 1) {
        continue; // re-fetch tip and replay on top
      }
      throw new GitError(
        `failed to push ${branchName(name)} to ${remote}: ${push.stderr.trim()}`,
        push.code,
        push.stderr,
      );
    } finally {
      // Clean up the temp index dir regardless of outcome.
      fs.rmSync(path.dirname(indexFile), { recursive: true, force: true });
    }
  }
  throw new Error(
    `could not push ${branchName(name)} after ${maxRetries} attempts (concurrent updates?)`,
  );
}
