import assert from "node:assert/strict";
import test from "node:test";
import { IsCanonicalViewPath, IsLoginPath, LoginPath, MediaTypeFromPathname, PathForView, RouteFromPathname, ViewFromPathname } from "../src/app/view-routes.js";

test("top-level URLs map to the correct app views", () => {
  assert.equal(ViewFromPathname("/rate"), "rater");
  assert.equal(ViewFromPathname("/wishlist"), "ai");
  assert.equal(ViewFromPathname("/sync"), "sync");
  assert.equal(ViewFromPathname("/wishlist/"), "ai");
  assert.deepEqual(RouteFromPathname("/movies/rate"), { mediaType: "movie", view: "rater" });
  assert.deepEqual(RouteFromPathname("/tv/wishlist"), { mediaType: "tv", view: "ai" });
  assert.equal(MediaTypeFromPathname("/tv/rate"), "tv");
});

test("app views map back to stable browser URLs", () => {
  assert.equal(PathForView("rater"), "/movies/rate");
  assert.equal(PathForView("ai"), "/movies/wishlist");
  assert.equal(PathForView("sync"), "/movies/sync");
  assert.equal(PathForView("rater", "tv"), "/tv/rate");
  assert.equal(PathForView("ai", "tv"), "/tv/wishlist");
  assert.equal(PathForView("sync", "tv"), "/tv/rate");
  assert.equal(IsCanonicalViewPath("/tv/wishlist"), true);
  assert.equal(IsCanonicalViewPath("/rate"), false);
});

test("login has one refreshable browser URL", () => {
  assert.equal(LoginPath, "/login");
  assert.equal(IsLoginPath("/login"), true);
  assert.equal(IsLoginPath("/login/"), true);
  assert.equal(IsLoginPath("/movies/rate"), false);
});
