import assert from "node:assert/strict";
import test from "node:test";
import { CreateSocialStore } from "../server/social-store.mjs";

const NoOp = () => undefined;
const FriendDisplayName = "Friend";
const FriendHandle = "friend";
const FriendId = "friend-1";
const ImageMediaType = "image/png";
const MovieMediaType = "movie";
const RecommendationQueueTable = "recommendation_queue";
const TitleId = "tt0113277";
const UserId = "user-1";
const ViewerHandle = "viewer";
const ViewerId = "viewer-1";

test("social title context exposes accepted friend ratings and share directions", VerifySocialTitleContext);

async function VerifySocialTitleContext() {
  const context = await CreateSocialStore(BuildSocialContextPool(UserId, FriendId)).GetSocialTitleContext(UserId, MovieMediaType, [TitleId]);
  assert.equal(context[TitleId].ratings[0].rating, 9);
  assert.equal(context[TitleId].ratings[0].profile.avatarUrl, `/api/avatars/${FriendId}?v=2`);
  assert.equal(context[TitleId].sharedBy[0].userId, FriendId);
  assert.deepEqual(context[TitleId].sharedWith, []);
}

function BuildSocialContextPool(userId, friendId) {
  return {
    async query(sql) {
      if (sql.startsWith("WITH friend_ids"))
        return { rows: [BuildFriendRatingRow(friendId)] };
      return { rows: [BuildShareRow(userId, friendId)] };
    }
  };
}

function BuildFriendRatingRow(friendId) {
  return {
    tt_id: TitleId,
    value: { rating: 9, at: "2026-07-23T12:00:00.000Z" },
    user_id: friendId,
    handle: FriendHandle,
    display_name: FriendDisplayName,
    avatar_version: 2
  };
}

function BuildShareRow(userId, friendId) {
  return {
    tt_id: TitleId,
    sender_user_id: friendId,
    recipient_user_id: userId,
    sender_id: friendId,
    sender_handle: FriendHandle,
    sender_name: FriendDisplayName,
    sender_avatar_version: 2,
    recipient_id: userId,
    recipient_handle: ViewerHandle,
    recipient_name: "Viewer",
    recipient_avatar_version: 1
  };
}

test("avatar reads include the viewer so profile privacy and blocks can be enforced", VerifyAvatarPrivacy);
test("user search accepts an @handle and escapes wildcard characters", VerifySearchEscaping);

async function VerifyAvatarPrivacy() {
  let parameters = null;
  const pool = {
    async query(sql, values) {
      assert.match(sql, /status='blocked'/);
      assert.match(sql, /status='accepted'/);
      parameters = values;
      return { rows: [{ content_type: ImageMediaType, image_data: Buffer.from([1]) }] };
    }
  };
  const avatar = await CreateSocialStore(pool).GetAvatar(ViewerId, FriendId);
  assert.deepEqual(parameters, [ViewerId, FriendId]);
  assert.equal(avatar.content_type, ImageMediaType);
}

async function VerifySearchEscaping() {
  let parameters = null;
  const pool = {
    async query(_sql, values) {
      parameters = values;
      return { rows: [] };
    }
  };
  await CreateSocialStore(pool).SearchUsers(ViewerId, "@Friend_Name");
  assert.deepEqual(parameters, [ViewerId, "%friend\\_name%", ""]);
}

test("shared recommendations are added transactionally only for accepted friends", VerifySharedRecommendations);

async function VerifySharedRecommendations() {
  const calls = [];
  const client = BuildSharingClient(calls);
  const pool = { connect: async () => client };
  const item = { queueKey: "heat|1995", ttId: TitleId, title: "Heat", year: 1995, genres: ["Crime"] };
  const results = await CreateSocialStore(pool).ShareRecommendation(UserId, [FriendId], item, MovieMediaType);
  assert.deepEqual(results, [{ recipientId: FriendId, status: "added" }]);
  assert.equal(calls[0], "BEGIN");
  assert.equal(calls.at(-1), "COMMIT");
  assert.ok(calls.some((sql) => sql.includes("recommendation_shares")));
  assert.ok(calls.some((sql) => sql.includes(RecommendationQueueTable)));
}

function BuildSharingClient(calls) {
  return {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("SELECT s.payload"))
        return { rows: [{ accepted: true, payload: { media: { [MovieMediaType]: { ratings: {}, recommendationExclusions: [] } } } }] };
      if (sql.includes("INSERT INTO") && sql.includes(RecommendationQueueTable))
        return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release: NoOp
  };
}
