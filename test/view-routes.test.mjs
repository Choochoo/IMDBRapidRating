import assert from "node:assert/strict";
import test from "node:test";
import { PathForView, ViewFromPathname } from "../src/app/view-routes.js";

test("top-level URLs map to the correct app views", () => {
  assert.equal(ViewFromPathname("/rate"), "rater");
  assert.equal(ViewFromPathname("/wishlist"), "ai");
  assert.equal(ViewFromPathname("/sync"), "sync");
  assert.equal(ViewFromPathname("/wishlist/"), "ai");
});

test("app views map back to stable browser URLs", () => {
  assert.equal(PathForView("rater"), "/rate");
  assert.equal(PathForView("ai"), "/wishlist");
  assert.equal(PathForView("sync"), "/sync");
});
