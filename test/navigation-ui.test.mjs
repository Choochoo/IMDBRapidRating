import assert from "node:assert/strict";
import test from "node:test";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";

const TvMediaType = "tv";
const SyncView = "sync";

test("movie and TV modes use the same concise navigation labels", VerifyConciseNavigationLabels);
test("TV sync navigation opens the movie sync workspace", VerifyTvSyncNavigation);

function VerifyConciseNavigationLabels() {
  VerifyMediaNavigation("movie", false, "/movies/rate", "/movies/wishlist");
  VerifyMediaNavigation(TvMediaType, true, "/tv/rate", "/tv/wishlist");
}

function VerifyMediaNavigation(mediaType, isTv, ratePath, watchlistPath) {
  const app = BuildNavigationApp(mediaType);
  app.UpdateMediaNavigation(isTv);
  assert.deepEqual(ReadNavigationLabels(app), ["Rate", "Watchlist", "Sync"]);
  assert.equal(app.Elements.tabRater.href, ratePath);
  assert.equal(app.Elements.tabAi.href, watchlistPath);
  assert.equal(app.Elements.tabSync.href, "/movies/sync");
  assert.equal(app.Elements.tabFriends.href, `/${mediaType === TvMediaType ? TvMediaType : "movies"}/friends`);
}

function BuildNavigationApp(mediaType) {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = { mediaType };
  app.Elements = {
    viewTabs: { setAttribute: () => null },
    tabRater: {},
    tabAi: {},
    tabSync: {},
    tabFriends: {}
  };
  return app;
}

function ReadNavigationLabels(app) {
  return [app.Elements.tabRater.textContent, app.Elements.tabAi.textContent, app.Elements.tabSync.textContent];
}

function VerifyTvSyncNavigation() {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = { mediaType: TvMediaType };
  app.CanLeaveShortcutSettings = () => true;
  app.OpenMovieSyncView = () => app.OpenedMovieSync = true;
  app.NavigateToView(SyncView);
  assert.equal(app.OpenedMovieSync, true);
}
