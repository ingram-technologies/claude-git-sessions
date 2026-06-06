/**
 * Resolve a user-supplied target (full UUID, unambiguous UUID prefix, or unique
 * display name) against a set of candidates.
 *
 * Pure and dependency-free so it is easy to unit-test. Returns either a single
 * match, or the list of candidates when the query is ambiguous, or nothing.
 */
export interface Candidate {
  id: string;
  name: string;
}

export type MatchResult<T extends Candidate> =
  | { kind: "match"; item: T }
  | { kind: "ambiguous"; items: T[] }
  | { kind: "none" };

export function resolveTarget<T extends Candidate>(
  query: string,
  candidates: T[],
): MatchResult<T> {
  const q = query.trim();

  // 1. Exact id wins outright.
  const exactId = candidates.filter((c) => c.id === q);
  if (exactId.length === 1) return { kind: "match", item: exactId[0] };

  // 2. Exact (case-insensitive) display-name match.
  const exactName = candidates.filter((c) => c.name.toLowerCase() === q.toLowerCase());
  if (exactName.length === 1) return { kind: "match", item: exactName[0] };
  if (exactName.length > 1) return { kind: "ambiguous", items: exactName };

  // 3. Git-style unambiguous id prefix (only for hex-ish queries).
  if (/^[0-9a-fA-F-]+$/.test(q) && q.length >= 4) {
    const byPrefix = candidates.filter((c) => c.id.startsWith(q.toLowerCase()));
    if (byPrefix.length === 1) return { kind: "match", item: byPrefix[0] };
    if (byPrefix.length > 1) return { kind: "ambiguous", items: byPrefix };
  }

  // 4. Fall back to a case-insensitive name substring.
  const bySubstr = candidates.filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()),
  );
  if (bySubstr.length === 1) return { kind: "match", item: bySubstr[0] };
  if (bySubstr.length > 1) return { kind: "ambiguous", items: bySubstr };

  return { kind: "none" };
}

/** Short 8-char id, git-style, for display. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
