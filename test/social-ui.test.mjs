import assert from "node:assert/strict";
import test from "node:test";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { ApplyAvatar, RenderAvatar, RenderSocialBadges } from "../src/app/social-rendering.js";

const FriendId = "friend-1";
const FriendHandle = "sam";
const SharedTitleId = "tt0083190";
const Friend = {
  userId: FriendId,
  handle: FriendHandle,
  displayName: "Sam",
  avatarVersion: 2,
  avatarUrl: `/api/avatars/${FriendId}?v=2`
};

test("poster social badges combine sharing and friend ratings without exposing account identity", VerifySocialBadges);
test("watchlist social filters can select shared, rated, or highly-rated friend titles", VerifySocialFilters);
test("profile images replace avatar initials", VerifyProfileImageReplacesInitial);
test("avatars retain initials when no profile image exists", VerifyAvatarInitialFallback);

function VerifySocialBadges() {
  const html = RenderSocialBadges({ ratings: [{ profile: Friend, rating: 9 }], sharedBy: [Friend], sharedWith: [] }, true);
  assert.match(html, /social-poster-badges/);
  assert.match(html, /Sam rated 9\/10/);
  assert.match(html, />9<\/strong>/);
  assert.doesNotMatch(html, new RegExp(`email|${FriendId}@example`));
}

function VerifySocialFilters() {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = { mediaType: "movie" };
  app.Social = BuildSocialFilterState();
  assert.equal(app.IsSocialRecommendationVisible({ ttId: "tt0113277" }), true);
  assert.equal(app.IsSocialRecommendationVisible({ ttId: SharedTitleId }), false);
  app.Social.filterMode = "shared";
  assert.equal(app.IsSocialRecommendationVisible({ ttId: SharedTitleId }), true);
}

function VerifyProfileImageReplacesInitial() {
  const element = BuildAvatarElement();
  ApplyAvatar(element, Friend);
  assert.equal(element.textContent, "");
  assert.equal(element.style.backgroundImage, `url("${Friend.avatarUrl}")`);
  assert.match(RenderAvatar(Friend), /aria-label="Sam"><\/span>$/);
}

function VerifyAvatarInitialFallback() {
  const profile = { ...Friend, avatarUrl: "" };
  const element = BuildAvatarElement();
  ApplyAvatar(element, profile);
  assert.equal(element.textContent, "S");
  assert.equal(element.style.backgroundImage, "");
  assert.match(RenderAvatar(profile), /aria-label="Sam">S<\/span>$/);
}

function BuildAvatarElement() {
  return {
    textContent: "",
    style: { backgroundImage: "" },
    setAttribute: () => null
  };
}

function BuildSocialFilterState() {
  const liked = BuildLikedContext();
  const shared = BuildSharedContext();
  const movie = {
    tt0113277: liked,
    [SharedTitleId]: shared
  };
  return {
    filterMode: "liked",
    filterFriendIds: [FriendId],
    context: { movie }
  };
}

function BuildLikedContext() {
  return {
    ratings: [{ profile: Friend, rating: 9 }],
    sharedBy: [],
    sharedWith: []
  };
}

function BuildSharedContext() {
  return {
    ratings: [{ profile: Friend, rating: 6 }],
    sharedBy: [Friend],
    sharedWith: []
  };
}
