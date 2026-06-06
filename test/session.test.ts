import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSession, remapCwd, truncateName } from "../src/session.js";

const FALLBACK = "0f569e3f-c81e-4274-997a-b71f61f8b832";

function jsonl(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

test("parseSession prefers ai-title for the display name", () => {
  const content = jsonl([
    { type: "user", sessionId: FALLBACK, cwd: "/x", timestamp: "2026-06-06T14:15:13.369Z", message: { role: "user", content: "hello world" } },
    { type: "ai-title", aiTitle: "Build the CLI tool", sessionId: FALLBACK },
    { type: "assistant", sessionId: FALLBACK, cwd: "/x", timestamp: "2026-06-06T14:16:00.000Z", message: { role: "assistant", content: "ok" } },
  ]);
  const info = parseSession(content, FALLBACK);
  assert.equal(info.displayName, "Build the CLI tool");
  assert.equal(info.id, FALLBACK);
  assert.equal(info.messageCount, 2);
  assert.equal(info.cwd, "/x");
  assert.equal(info.updatedAt, "2026-06-06T14:16:00.000Z");
});

test("parseSession falls back to summary then first user message", () => {
  const summaryOnly = jsonl([
    { type: "summary", summary: "A short summary", sessionId: FALLBACK },
    { type: "user", sessionId: FALLBACK, message: { role: "user", content: "the prompt" } },
  ]);
  assert.equal(parseSession(summaryOnly, FALLBACK).displayName, "A short summary");

  const userOnly = jsonl([
    { type: "user", sessionId: FALLBACK, message: { role: "user", content: "first prompt here" } },
  ]);
  assert.equal(parseSession(userOnly, FALLBACK).displayName, "first prompt here");
});

test("parseSession handles array content blocks and missing sessionId", () => {
  const content = jsonl([
    { type: "user", message: { role: "user", content: [{ type: "text", text: "block text" }] } },
  ]);
  const info = parseSession(content, FALLBACK);
  assert.equal(info.displayName, "block text");
  assert.equal(info.id, FALLBACK, "uses fallback id when no sessionId present");
});

test("parseSession falls back to the id when nothing else is available", () => {
  const content = jsonl([{ type: "mode", mode: "default", sessionId: FALLBACK }]);
  assert.equal(parseSession(content, FALLBACK).displayName, FALLBACK);
});

test("truncateName collapses whitespace and truncates", () => {
  assert.equal(truncateName("a   b\nc"), "a b c");
  const long = "x".repeat(200);
  const out = truncateName(long, 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith("…"));
});

test("remapCwd rewrites only the structural cwd field, not transcript text", () => {
  const from = "/home/alice/proj";
  const to = "/home/bob/proj";
  const content = jsonl([
    { type: "user", cwd: from, message: { role: "user", content: `ran in ${from} earlier` } },
    { type: "assistant", cwd: from, message: { role: "assistant", content: "ok" } },
    { type: "mode", mode: "default" },
  ]);
  const out = remapCwd(content, from, to);
  const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));

  // structural cwd updated on both message lines
  assert.equal(lines[0].cwd, to);
  assert.equal(lines[1].cwd, to);
  // free-text mention of the old path inside content is preserved verbatim
  assert.equal(lines[0].message.content, `ran in ${from} earlier`);
});

test("remapCwd is a no-op when from === to", () => {
  const content = jsonl([{ type: "user", cwd: "/x" }]);
  assert.equal(remapCwd(content, "/x", "/x"), content);
});

test("remapCwd leaves non-matching cwd lines untouched", () => {
  const content = jsonl([{ type: "user", cwd: "/other" }]);
  const out = remapCwd(content, "/home/alice", "/home/bob");
  assert.equal(JSON.parse(out.split("\n")[0]).cwd, "/other");
});
