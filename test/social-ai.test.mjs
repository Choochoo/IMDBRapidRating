import assert from "node:assert/strict";
import test from "node:test";
import { GenerateAiRecommendations } from "../server/ai-recommendations.mjs";

const FriendAudience = "friend";
const FriendsTasteAudience = "friends";
const TestModel = "test-model";

test("friend-only recommendations send minimized ratings without friend identity", VerifyFriendRecommendations);

async function VerifyFriendRecommendations() {
  const calls = [];
  const result = await GenerateAiRecommendations(process.cwd(), BuildFriendOptions(calls));
  AssertFriendProfile(result, calls);
}

function BuildFriendRatings() {
  return Array.from({ length: 5 }, BuildFriendRating);
}

function BuildFriendRating(_value, index) {
  return {
    title: `Friend Pick ${index + 1}`,
    year: 2000 + index,
    rating: 10 - index,
    mediaType: "movie",
    sourceAudience: FriendAudience,
    email: `friend${index}@example.com`,
    handle: `friend-${index}`
  };
}

function BuildFriendOptions(calls) {
  return {
    baseUrl: "https://ai.example.test/v1",
    model: TestModel,
    count: 1,
    tasteAudience: FriendsTasteAudience,
    friendRatings: BuildFriendRatings(),
    targetRatings: [],
    requestAiChat: BuildChatRequester(calls),
    profile: { ratings: [], exclusions: [] }
  };
}

function AssertFriendProfile(result, calls) {
  assert.equal(result.status, 200);
  const profile = JSON.parse(calls[0].messages[1].content);
  assert.equal(profile.tasteAudience, FriendsTasteAudience);
  assert.ok(profile.ratings.every((rating) => rating.sourceAudience === FriendAudience));
  assert.equal(JSON.stringify(profile).includes("@example.com"), false);
  assert.equal(JSON.stringify(profile).includes("friend-0"), false);
}

function BuildChatRequester(calls) {
  return async (_options, messages) => {
    calls.push({ messages });
    const recommendation = BuildRecommendation();
    return { status: 200, payload: { ok: true, content: JSON.stringify({ summary: "Friend taste", recommendations: [recommendation] }), model: TestModel } };
  };
}

function BuildRecommendation() {
  return {
    title: "Shared Taste Result",
    year: 2025,
    genres: ["Drama"],
    originCountries: ["US"],
    originalLanguage: "en",
    why: { tasteMatch: "A shared fit.", ratingEvidence: ["Friend evidence."] }
  };
}
