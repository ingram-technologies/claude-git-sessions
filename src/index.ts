#!/usr/bin/env node
import { Command } from "commander";
import {
  COMMAND_NAME,
  DEFAULT_BRANCH_NAME,
  DEFAULT_REMOTE,
  PACKAGE_NAME,
} from "./constants.js";
import { repoRoot } from "./git.js";
import { pull } from "./commands/pull.js";
import { push } from "./commands/push.js";
import { deleteSession } from "./commands/delete.js";
import { memoryPull, memoryPush } from "./commands/memory.js";

// Kept in sync with package.json at publish time; hardcoded to avoid a JSON
// import assertion just for --version.
const VERSION = "0.2.0";

interface GlobalOpts {
  branch: string;
  remote: string;
}

function globals(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals() as { branch?: string; remote?: string };
  return {
    branch: opts.branch ?? DEFAULT_BRANCH_NAME,
    remote: opts.remote ?? DEFAULT_REMOTE,
  };
}

async function run(fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (err) {
    console.error(`${COMMAND_NAME}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name(COMMAND_NAME)
  .description(`${PACKAGE_NAME} — share Claude Code sessions through an orphan git branch`)
  .version(VERSION, "-v, --version")
  .option("-b, --branch <name>", "session set name (branch @ccgs/<name>)", DEFAULT_BRANCH_NAME)
  .option("--remote <remote>", "git remote to use", DEFAULT_REMOTE);

program
  .command("pull")
  .description("fetch shared sessions and place them where Claude Code can resume them")
  .option("--force", "overwrite local copies even if they are newer", false)
  .action(async (localOpts: { force: boolean }, cmd: Command) => {
    const g = globals(cmd);
    await run(async () => {
      const root = await repoRoot();
      return pull({ repoRoot: root, remote: g.remote, branch: g.branch, force: localOpts.force });
    });
  });

program
  .command("push")
  .description("publish this repo's local sessions to the orphan branch")
  .argument("[targets...]", "optional session ids/names to push (default: all)")
  .action(async (targets: string[], _localOpts: unknown, cmd: Command) => {
    const g = globals(cmd);
    await run(async () => {
      const root = await repoRoot();
      return push({ repoRoot: root, remote: g.remote, branch: g.branch, filters: targets });
    });
  });

program
  .command("delete")
  .description("remove a session from the shared orphan branch")
  .argument("<target>", "session id, unambiguous id prefix, or unique name")
  .option("-y, --yes", "skip the interactive confirmation", false)
  .option("--local", "also remove the local copy under ~/.claude/projects", false)
  .action(async (target: string, localOpts: { yes: boolean; local: boolean }, cmd: Command) => {
    const g = globals(cmd);
    await run(async () => {
      const root = await repoRoot();
      return deleteSession({
        repoRoot: root,
        remote: g.remote,
        branch: g.branch,
        target,
        yes: localOpts.yes,
        local: localOpts.local,
      });
    });
  });

const memory = program
  .command("memory")
  .description("share Claude Code memory files (project/reference facts) for this repo");

memory
  .command("push")
  .description("publish this repo's shareable memory to the orphan branch")
  .option("--all", "include personal user/feedback memories too", false)
  .action(async (localOpts: { all: boolean }, cmd: Command) => {
    const g = globals(cmd);
    await run(async () => {
      const root = await repoRoot();
      return memoryPush({ repoRoot: root, remote: g.remote, branch: g.branch, all: localOpts.all });
    });
  });

memory
  .command("pull")
  .description("fetch shared memory and update this repo's local MEMORY.md index")
  .option("--all", "include personal user/feedback memories too", false)
  .option("--force", "overwrite local copies even if they are newer", false)
  .action(async (localOpts: { all: boolean; force: boolean }, cmd: Command) => {
    const g = globals(cmd);
    await run(async () => {
      const root = await repoRoot();
      return memoryPull({
        repoRoot: root,
        remote: g.remote,
        branch: g.branch,
        all: localOpts.all,
        force: localOpts.force,
      });
    });
  });

// `ccgs memory` with no subcommand: show its help on stdout and exit 0.
memory.action(() => {
  memory.outputHelp();
  process.exit(0);
});

// With no subcommand, print help to stdout and exit 0 — Commander's default is
// to print to stderr and exit 1, which looks like an error to anyone running
// the bare command (e.g. `npx claude-git-sessions`).
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv);
