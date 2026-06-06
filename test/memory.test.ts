import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexLine,
  isShareable,
  parseFrontmatter,
  titleFor,
  updateIndexBlock,
} from "../src/memory.js";

const FM = `---
name: deploy-process
description: How we ship to prod
metadata:
  type: project
---

The deploy runbook lives at ...
`;

test("parseFrontmatter extracts name, description, and nested type", () => {
  const fm = parseFrontmatter(FM);
  assert.equal(fm.name, "deploy-process");
  assert.equal(fm.description, "How we ship to prod");
  assert.equal(fm.type, "project");
});

test("parseFrontmatter degrades to unknown when type is missing/odd", () => {
  assert.equal(parseFrontmatter("no frontmatter here").type, "unknown");
  assert.equal(parseFrontmatter("---\nname: x\n---\nbody").type, "unknown");
  assert.equal(parseFrontmatter("---\nmetadata:\n  type: weird\n---\n").type, "unknown");
});

test("parseFrontmatter handles quoted values", () => {
  const fm = parseFrontmatter(`---\nname: "x"\ndescription: 'a b'\nmetadata:\n  type: reference\n---\n`);
  assert.equal(fm.name, "x");
  assert.equal(fm.description, "a b");
  assert.equal(fm.type, "reference");
});

test("isShareable: project/reference shared by default; user/feedback only with --all", () => {
  assert.equal(isShareable("project", false), true);
  assert.equal(isShareable("reference", false), true);
  assert.equal(isShareable("user", false), false);
  assert.equal(isShareable("feedback", false), false);
  assert.equal(isShareable("unknown", false), false);
  // --all shares everything
  for (const t of ["project", "reference", "user", "feedback", "unknown"] as const) {
    assert.equal(isShareable(t, true), true);
  }
});

test("titleFor derives Title Case from name, falling back to filename", () => {
  assert.equal(titleFor({ filename: "deploy-process.md", name: "deploy-process" }), "Deploy Process");
  assert.equal(titleFor({ filename: "ci_setup.md", name: null }), "Ci Setup");
});

test("indexLine renders the pointer, omitting the dash when no description", () => {
  assert.equal(
    indexLine({ filename: "a.md", title: "A", description: "hook text" }),
    "- [A](a.md) — hook text",
  );
  assert.equal(indexLine({ filename: "a.md", title: "A", description: null }), "- [A](a.md)");
});

test("updateIndexBlock appends a managed block, preserving existing content", () => {
  const existing = "# My memory index\n\n- [Personal](me.md) — mine\n";
  const out = updateIndexBlock(existing, ["- [Shared](s.md) — theirs"]);
  assert.ok(out.includes("# My memory index"));
  assert.ok(out.includes("- [Personal](me.md) — mine"));
  assert.ok(out.includes("- [Shared](s.md) — theirs"));
  assert.ok(out.includes("ccgs:shared-memory"));
});

test("updateIndexBlock replaces an existing managed block idempotently", () => {
  const first = updateIndexBlock("# Index\n", ["- [A](a.md)"]);
  const second = updateIndexBlock(first, ["- [B](b.md)"]);
  // old generated line is gone, new one present, user heading kept, single block
  assert.ok(!second.includes("[A](a.md)"));
  assert.ok(second.includes("[B](b.md)"));
  assert.ok(second.includes("# Index"));
  assert.equal(second.match(/ccgs:shared-memory \(managed/g)?.length, 1);
});
