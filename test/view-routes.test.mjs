import assert from "node:assert/strict";
import test from "node:test";
import { AiSettingsPath, IsCanonicalViewPath, IsLoginPath, LoginPath, MediaTypeFromPathname, PathForView, RouteFromPathname, SettingsPath, ShortcutSettingsPath, ViewFromPathname } from "../src/app/view-routes.js";

const MovieRatePath = "/movies/rate";
const TvRatePath = "/tv/rate";
const TvWishlistPath = "/tv/wishlist";
const TvFriendsPath = "/tv/friends";
const LegacyRatePath = "/rate";
const AiSettingsView = "ai-settings";
const AiView = "ai";
const FriendsView = "friends";
const RaterView = "rater";
const SettingsView = "settings";
const SyncView = "sync";
const TvMediaType = "tv";

test("top-level URLs map to the correct app views", VerifyTopLevelRoutes);
test("app views map back to stable browser URLs", VerifyViewPaths);
test("login has one refreshable browser URL", VerifyLoginPath);

function VerifyTopLevelRoutes() {
  assert.equal(ViewFromPathname(LegacyRatePath), RaterView);
  assert.equal(ViewFromPathname("/wishlist"), AiView);
  assert.equal(ViewFromPathname("/sync"), SyncView);
  assert.equal(ViewFromPathname("/friends"), FriendsView);
  assert.equal(ViewFromPathname(AiSettingsPath), AiSettingsView);
  assert.equal(ViewFromPathname(SettingsPath), SettingsView);
  assert.equal(ViewFromPathname(ShortcutSettingsPath), SettingsView);
  assert.equal(ViewFromPathname("/wishlist/"), AiView);
  assert.deepEqual(RouteFromPathname(MovieRatePath), { mediaType: "movie", view: RaterView });
  assert.deepEqual(RouteFromPathname(TvWishlistPath), { mediaType: TvMediaType, view: AiView });
  assert.deepEqual(RouteFromPathname(TvFriendsPath), { mediaType: TvMediaType, view: FriendsView });
  assert.equal(MediaTypeFromPathname(TvRatePath), TvMediaType);
}

function VerifyViewPaths() {
  assert.equal(PathForView(RaterView), MovieRatePath);
  assert.equal(PathForView(AiView), "/movies/wishlist");
  assert.equal(PathForView(SyncView), "/movies/sync");
  assert.equal(PathForView(AiSettingsView), AiSettingsPath);
  assert.equal(PathForView(SettingsView), SettingsPath);
  assert.equal(PathForView(RaterView, TvMediaType), TvRatePath);
  assert.equal(PathForView(AiView, TvMediaType), TvWishlistPath);
  assert.equal(PathForView(FriendsView, TvMediaType), TvFriendsPath);
  assert.equal(PathForView(SyncView, TvMediaType), TvRatePath);
  VerifyCanonicalPaths();
}

function VerifyCanonicalPaths() {
  assert.equal(IsCanonicalViewPath(TvWishlistPath), true);
  assert.equal(IsCanonicalViewPath(AiSettingsPath), true);
  assert.equal(IsCanonicalViewPath(SettingsPath), true);
  assert.equal(IsCanonicalViewPath(ShortcutSettingsPath), true);
  assert.equal(IsCanonicalViewPath(LegacyRatePath), false);
}

function VerifyLoginPath() {
  assert.equal(LoginPath, "/login");
  assert.equal(IsLoginPath(LoginPath), true);
  assert.equal(IsLoginPath("/login/"), true);
  assert.equal(IsLoginPath(MovieRatePath), false);
}
