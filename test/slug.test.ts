import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToProjectSlug } from "../src/slug.js";

test("pathToProjectSlug encodes paths the way Claude Code does", () => {
  assert.equal(pathToProjectSlug("/home/user"), "-home-user");
  assert.equal(pathToProjectSlug("/home/user/code/api"), "-home-user-code-api");
  // dots become '-'
  assert.equal(
    pathToProjectSlug("/home/user/code/my.app.dev"),
    "-home-user-code-my-app-dev",
  );
  // existing '-' is kept
  assert.equal(
    pathToProjectSlug("/home/user/code/web-client"),
    "-home-user-code-web-client",
  );
});

test("pathToProjectSlug is lossy: distinct paths can collide", () => {
  // This is expected — both map to the same slug.
  assert.equal(
    pathToProjectSlug("/a/b.c"),
    pathToProjectSlug("/a/b-c"),
  );
});

test("pathToProjectSlug keeps alphanumerics and case", () => {
  assert.equal(pathToProjectSlug("/Users/Bob/MyApp2"), "-Users-Bob-MyApp2");
});
