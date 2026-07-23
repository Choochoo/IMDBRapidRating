import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { RegisterSocialRoutes } from "../server/social-routes.mjs";

const CsrfToken = "social-test-csrf-token";
const UserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FriendId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RelationshipId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const Heat = { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime", "Drama"] };
const CsrfHeader = "x-csrf-token";
const MovieMediaType = "movie";
const AddedStatus = "added";
const PngContentType = "image/png";
const ProfilePath = "/api/profile";
const FriendRequestsPath = "/api/friends/requests";
const SocialSharePath = "/api/social/share";
const ProfileAvatarPath = "/api/profile/avatar";
const AcceptAction = "accept";
const ContentTypeHeader = "content-type";
const DeleteAction = "delete";
const FriendHandle = "friend";
const RequestAction = "request";
const ViewerHandle = "viewer";
const ViewerName = "Viewer Name";

test("profiles are authenticated, CSRF protected, and searchable without returning email", VerifyProfiles);
test("friend requests can be sent, accepted, and removed by authenticated users", VerifyFriendRequests);
test("sharing uses the canonical catalog title and notifies an added recipient", VerifySharing);
test("avatar uploads validate image signatures and update the avatar version", VerifyAvatarUpload);

async function VerifyProfiles() {
  const state = { updated: null };
  const profile = Profile(UserId, ViewerHandle);
  const agent = request.agent(BuildSocialTestApp(BuildProfileStore(profile, state)));
  assert.equal((await agent.get(ProfilePath).expect(200)).body.profile.handle, ViewerHandle);
  await agent.put(ProfilePath).send(ProfileRequest()).expect(403);
  const saved = await agent.put(ProfilePath).set(CsrfHeader, CsrfToken).send(ProfileRequest()).expect(200);
  assert.equal(state.updated.handle, "viewer-name");
  assert.equal(saved.body.profile.displayName, ViewerName);
  const search = await agent.get("/api/friends/search?q=friend@example.com").expect(200);
  assert.equal(search.body.results[0].profile.handle, FriendHandle);
  assert.equal(JSON.stringify(search.body).includes("email"), false);
}

function BuildProfileStore(profile, state) {
  return {
    GetProfile: async () => profile,
    UpdateProfile: async (_userId, value) => {
      state.updated = value;
      return { ...profile, ...value };
    },
    SearchUsers: async () => [{ profile: Profile(FriendId, FriendHandle), relationshipId: "", relationshipStatus: "none", outgoing: false }]
  };
}

async function VerifyFriendRequests() {
  const calls = [];
  const agent = request.agent(BuildSocialTestApp(BuildFriendRequestStore(calls)));
  await agent.post(FriendRequestsPath).set(CsrfHeader, CsrfToken).send({ userId: FriendId }).expect(201);
  await agent.put(`${FriendRequestsPath}/${RelationshipId}/accept`).set(CsrfHeader, CsrfToken).send({}).expect(200);
  await agent.delete(`/api/friends/relationships/${RelationshipId}`).set(CsrfHeader, CsrfToken).send({}).expect(200);
  assert.deepEqual(calls, [[RequestAction, UserId, FriendId], [AcceptAction, UserId, RelationshipId], [DeleteAction, UserId, RelationshipId]]);
}

function BuildFriendRequestStore(calls) {
  return {
    CreateFriendRequest: async (userId, recipientId) => RecordFriendRequest(calls, userId, recipientId),
    AcceptFriendRequest: async (userId, relationshipId) => RecordRelationship(calls, AcceptAction, userId, relationshipId),
    DeleteFriendship: async (userId, relationshipId) => RecordRelationship(calls, DeleteAction, userId, relationshipId)
  };
}

function RecordFriendRequest(calls, userId, recipientId) {
  calls.push([RequestAction, userId, recipientId]);
  return { id: RelationshipId, requester_user_id: userId, recipient_user_id: recipientId, status: "pending" };
}

function RecordRelationship(calls, action, userId, relationshipId) {
  calls.push([action, userId, relationshipId]);
  return true;
}

async function VerifySharing() {
  const state = { received: null, notified: null };
  const dependencies = { onRecommendationDelivered: async (userId, mediaType) => state.notified = { userId, mediaType } };
  const agent = request.agent(BuildSocialTestApp(BuildSharingStore(state), dependencies));
  const response = await agent.post(SocialSharePath).set(CsrfHeader, CsrfToken).send({ mediaType: MovieMediaType, ttId: Heat.ttId, recipientIds: [FriendId] }).expect(200);
  assert.equal(state.received.item.title, Heat.title);
  assert.equal(state.received.item.queueKey, "heat|1995");
  assert.deepEqual(state.notified, { userId: FriendId, mediaType: MovieMediaType });
  assert.equal(response.body.results[0].status, AddedStatus);
}

function BuildSharingStore(state) {
  return {
    ShareRecommendation: async (userId, recipientIds, item, mediaType) => {
      state.received = { userId, recipientIds, item, mediaType };
      return [{ recipientId: FriendId, status: AddedStatus }];
    }
  };
}

async function VerifyAvatarUpload() {
  const state = { saved: null, avatarRead: null };
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const agent = request.agent(BuildSocialTestApp(BuildAvatarStore(state, png)));
  await agent.put(ProfileAvatarPath).set(CsrfHeader, CsrfToken).set(ContentTypeHeader, PngContentType).send(Buffer.from("not-an-image")).expect(422);
  const response = await agent.put(ProfileAvatarPath).set(CsrfHeader, CsrfToken).set(ContentTypeHeader, PngContentType).send(png).expect(200);
  await agent.get(`/api/avatars/${FriendId}`).expect(ContentTypeHeader, /image\/png/).expect(200);
  assert.equal(state.saved.contentType, PngContentType);
  assert.equal(state.saved.data.equals(png), true);
  assert.deepEqual(state.avatarRead, { viewerId: UserId, userId: FriendId });
  assert.match(response.body.avatarUrl, /v=4/);
}

function BuildAvatarStore(state, png) {
  return {
    PutAvatar: async (userId, contentType, data) => {
      state.saved = { userId, contentType, data };
      return 4;
    },
    GetAvatar: async (viewerId, userId) => {
      state.avatarRead = { viewerId, userId };
      return { content_type: PngContentType, image_data: png };
    }
  };
}

function BuildSocialTestApp(store, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-social-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  app.use(InstallSession);
  RegisterSocialRoutes(app, { store, rootPath: process.cwd(), readMoviePool: async () => ({ titles: [Heat] }), readTitlePool: async () => ({ titles: [] }), ...overrides });
  return app;
}

function InstallSession(request, _response, next) {
  request.session.userId = UserId;
  request.session.csrfToken = CsrfToken;
  next();
}

function Profile(userId, handle) {
  return {
    userId,
    handle,
    displayName: handle === ViewerHandle ? "Viewer" : "Friend",
    avatarVersion: 0,
    avatarUrl: "",
    searchable: true,
    shareRatingsWithFriends: true,
    showFriendRatings: true
  };
}

function ProfileRequest() {
  return {
    handle: "Viewer-Name",
    displayName: ViewerName,
    searchable: true,
    shareRatingsWithFriends: true,
    showFriendRatings: true
  };
}
