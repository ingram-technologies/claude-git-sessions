/**
 * Single source of truth for the package + command identity, so renaming is a
 * one-line change.
 */
/**
 * npm package name. The bare name `ccgs` is blocked by npm's name-similarity
 * filter, so the package ships as `claude-git-sessions`; the installed command is still
 * `ccgs` (see COMMAND_NAME). Both are one-line changes if either is renamed.
 */
export const PACKAGE_NAME = "claude-git-sessions";
export const COMMAND_NAME = "ccgs";

/** Orphan branches are namespaced as `@ccgs/<name>`. */
export const BRANCH_PREFIX = "@ccgs/";
export const DEFAULT_BRANCH_NAME = "default";
export const DEFAULT_REMOTE = "origin";

/** Path prefix used for session blobs on the orphan branch. */
export const SESSIONS_DIR = "sessions";

/** Max length of an auto-derived display name. */
export const DISPLAY_NAME_MAX = 80;
