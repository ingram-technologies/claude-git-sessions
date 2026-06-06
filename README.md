# ccgs — Claude Code Git Sessions

Share [Claude Code](https://claude.com/claude-code) sessions across a team
through an **orphan branch in your existing git repo**. No server, no extra
infrastructure — your transcripts ride along with the code they belong to.

> Published on npm as **`claude-git-sessions`** (the bare name `ccgs` is blocked by npm's
> name-similarity filter). The command it installs is **`ccgs`**.

```bash
npx claude-git-sessions pull     # bring shared sessions onto this machine
npx claude-git-sessions push     # publish your local sessions for this repo
npx claude-git-sessions delete <id|name>
```

After `pull`, resume any teammate's session locally with:

```bash
claude --resume <session-id>
```

## Install

Run on demand with `npx` (no install):

```bash
npx claude-git-sessions pull
```

…or install globally (this installs the `ccgs` command):

```bash
npm i -g claude-git-sessions
ccgs --help
```

Requires **Node 20+** and **git 2.5+**. Run it from inside your git repo.

## How it works

Sessions are stored on an **orphan branch** named `@ccgs/<name>` (default
`@ccgs/default`) on your repo's remote (default `origin`). The branch shares no
history with `main` and never contains your source files — only session data:

```
sessions/<session-id>.jsonl        # the transcript, verbatim
sessions/<session-id>.meta.json    # sidecar metadata (name, author, cwd, …)
```

Files are keyed by the globally-unique Claude Code session UUID, so transcripts
from different authors never collide.

Every `ccgs` operation is done with low-level git plumbing
(`hash-object`/`update-index`/`write-tree`/`commit-tree`/`push`) against a
private temporary index. **Your working tree, index, and current branch are
never touched**, and everything works even with a dirty tree. Concurrent pushes
are handled by re-fetching and replaying on a non-fast-forward rejection.

### Branch namespacing

The `@ccgs/<name>` namespace lets you keep separate session sets. Use the
default for the team's shared sessions, and a private name for your own
work-in-progress that you don't want to share yet:

```bash
ccgs push -b my-wip      # publish to @ccgs/my-wip
ccgs pull -b my-wip      # only your private set
ccgs push                # the shared @ccgs/default set
```

Branch names are validated with `git check-ref-format` before use.

## Commands

### `ccgs pull`

Fetches `@ccgs/<name>` and writes each session where Claude Code expects it:
`~/.claude/projects/<local-slug>/<id>.jsonl`. The structural `cwd` field in each
transcript line is rewritten from the author's path to your local equivalent so
`claude --resume` works. (Absolute paths inside tool *output* are left as-is —
cosmetic only.)

If a local session is **newer** than the shared copy it is skipped with a
warning; pass `--force` to overwrite anyway. Prints what was pulled / skipped.

If the branch doesn't exist, it prints `nothing to pull` and exits 0.

### `ccgs push [targets...]`

Finds local sessions whose working directory is this repo (or a subdirectory),
copies each transcript verbatim onto the orphan branch, and (re)generates its
`meta.json`. With no arguments it pushes all of them; pass session ids/names to
push only those. Creates the orphan branch on first push. Reports added vs
updated.

### `ccgs delete <id|name> [--yes] [--local]`

Resolves the target by full UUID, unambiguous UUID prefix (git-style, ≥4
chars), or unique display name — listing candidates and aborting if ambiguous.
Shows what will be deleted and asks for `y/N` confirmation (`--yes`/`-y` to skip
for scripting). Removes both files from the branch and pushes. By default only
the shared branch is touched; add `--local` to also remove the local copy.

### Global options

| Option | Default | Meaning |
| --- | --- | --- |
| `-b, --branch <name>` | `default` | session set → branch `@ccgs/<name>` |
| `--remote <remote>` | `origin` | git remote to use |
| `-v, --version` | | print version |
| `-h, --help` | | help |

## Step 0 findings — how Claude Code stores sessions

These assumptions were verified empirically against a real `~/.claude/` before
writing the tool. They live in one place each so they're easy to fix if the
convention changes.

### Project slug encoding (`src/slug.ts`)

Claude Code stores each project's sessions under
`~/.claude/projects/<slug>/`, where the slug is derived from the absolute
working directory. Comparing real directories to the `cwd` recorded inside their
session files showed the rule is: **replace every character that is not
`[A-Za-z0-9]` with `-`**.

| Working directory | Slug |
| --- | --- |
| `/home/user` | `-home-user` |
| `/home/user/code/api` | `-home-user-code-api` |
| `/home/user/code/my.app.dev` | `-home-user-code-my-app-dev` |
| `/home/user/code/web-client` | `-home-user-code-web-client` |

Note that both `/` and `.` map to `-`, so the encoding is **lossy and
irreversible**. ccgs therefore only ever goes path → slug, and stores the real
`originalCwd` separately in `meta.json`.

The config root honors `CLAUDE_CONFIG_DIR` and falls back to `~/.claude`. Local
sessions live at `<config>/projects/<slug>/<session-id>.jsonl`.

### Session `.jsonl` schema (`src/session.ts`)

Each session is **JSONL** — one JSON object per line, with many object `type`s
(`user`, `assistant`, `attachment`, `ai-title`, `mode`, `tool_result`, …).
Verified fields:

- **Session UUID** — `sessionId`, present on most lines, equal to the filename.
- **Title / name** — a `{ "type": "ai-title", "aiTitle": "…" }` line. Older
  versions used `{ "type": "summary", "summary": "…" }`; some objects also carry
  a `title`. The display name resolves: title → summary → first user message
  (truncated) → session id.
- **Working directory** — the `cwd` field, present on `user`/`assistant`/
  `attachment` lines. This is the **only** field `pull` rewrites.
- **Timestamps** — per-line `timestamp` (ISO-8601). `updatedAt` is the max.
- **First user message** — `message.content` on the first `type:"user"` line;
  `content` is a string or an array of content blocks (each may have `.text`).

## Known considerations / future work

- **Secret redaction** — transcripts are pushed verbatim. If your sessions may
  contain secrets, scrub them before pushing. A `--redact` flag is a likely
  future addition. **Not implemented today.**
- **Git LFS** — very large transcripts are committed as ordinary blobs. LFS
  handling may be added later.

## Development

```bash
npm install
npm run build      # tsc -> dist/, chmod +x the bin
npm test           # node:test unit tests (no live Claude install needed)
npm run typecheck
```

Tests cover the pure pieces: slug encoding, display-name resolution,
id/prefix/name matching, and the `cwd` remap transform.

## License

MIT
