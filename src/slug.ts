/**
 * Convert an absolute filesystem path into the directory slug Claude Code uses
 * under `~/.claude/projects/`.
 *
 * Verified empirically against a real `~/.claude/projects/` by comparing each
 * project directory name to the `cwd` recorded inside its session `.jsonl`
 * files. Illustrative examples:
 *
 *   /home/user                       -> -home-user
 *   /home/user/code/api              -> -home-user-code-api
 *   /home/user/code/my.app.dev       -> -home-user-code-my-app-dev   (dot  -> '-')
 *   /home/user/code/web-client       -> -home-user-code-web-client   (existing '-' kept)
 *
 * Rule: replace every character that is NOT [A-Za-z0-9] with '-'. The leading
 * '/' therefore becomes a leading '-'.
 *
 * IMPORTANT: this encoding is LOSSY — both '/' and '.' (and any other special
 * character) map to '-', so it cannot be reversed back into a unique path.
 * That is why ccgs only ever goes path -> slug, never slug -> path, and why the
 * sidecar `meta.json` carries the real `originalCwd` separately.
 *
 * Keep this as the ONE place that encodes the convention, so it is trivial to
 * fix if Claude Code ever changes it.
 */
export function pathToProjectSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}
