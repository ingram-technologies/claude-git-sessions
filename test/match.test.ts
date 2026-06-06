import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, shortId } from "../src/match.js";

const items = [
  { id: "0f569e3f-c81e-4274-997a-b71f61f8b832", name: "Build the CLI tool" },
  { id: "0f56ffff-aaaa-bbbb-cccc-ddddeeeeffff", name: "Fix the bug" },
  { id: "12345678-0000-0000-0000-000000000000", name: "Build the CLI tool" },
];

test("exact id matches outright", () => {
  const r = resolveTarget("0f569e3f-c81e-4274-997a-b71f61f8b832", items);
  assert.equal(r.kind, "match");
  if (r.kind === "match") assert.equal(r.item.name, "Build the CLI tool");
});

test("unambiguous id prefix matches git-style", () => {
  const r = resolveTarget("0f569", items);
  assert.equal(r.kind, "match");
  if (r.kind === "match") assert.equal(r.item.id, items[0].id);
});

test("ambiguous id prefix returns candidates", () => {
  const r = resolveTarget("0f56", items); // matches both 0f569... and 0f56ffff...
  assert.equal(r.kind, "ambiguous");
  if (r.kind === "ambiguous") assert.equal(r.items.length, 2);
});

test("too-short id prefix does not match by prefix", () => {
  // git-style minimum prefix length is 4; "0f" should not resolve.
  assert.equal(resolveTarget("0f", items).kind, "none");
});

test("unique name matches case-insensitively", () => {
  const r = resolveTarget("fix the bug", items);
  assert.equal(r.kind, "match");
  if (r.kind === "match") assert.equal(r.item.id, items[1].id);
});

test("duplicate name is ambiguous", () => {
  const r = resolveTarget("Build the CLI tool", items);
  assert.equal(r.kind, "ambiguous");
  if (r.kind === "ambiguous") assert.equal(r.items.length, 2);
});

test("name substring matches when unique", () => {
  const r = resolveTarget("bug", items);
  assert.equal(r.kind, "match");
  if (r.kind === "match") assert.equal(r.item.id, items[1].id);
});

test("no match returns none", () => {
  assert.equal(resolveTarget("nonexistent-xyz", items).kind, "none");
});

test("shortId is the first 8 chars", () => {
  assert.equal(shortId("0f569e3f-c81e"), "0f569e3f");
});
