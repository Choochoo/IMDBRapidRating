import express from "express";
import { rateLimit } from "express-rate-limit";
import { RequireCsrf } from "./auth.mjs";
import { NormalizeRecommendationItem } from "./recommendation-queue.mjs";
import { FriendRequestSchema, ProfileSchema, SearchSchema, ShareSchema, SocialContextSchema, UserIdSchema, UsernameSchema } from "./social-schemas.mjs";

const MaximumAvatarBytes = 1024 * 1024;
const DraftStandardHeaders = "draft-8";
const ContentTypeHeader = "content-type";
const JpegMediaType = "image/jpeg";
const PngMediaType = "image/png";
const WebpMediaType = "image/webp";
const AsciiEncoding = "ascii";
const ProfileRoute = "/api/profile";
const ProfileAvatarRoute = "/api/profile/avatar";
const ProfileUsernameRoute = "/api/profile/username";
const AvatarMediaTypes = Object.freeze([JpegMediaType, PngMediaType, WebpMediaType]);
const SearchLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: DraftStandardHeaders, legacyHeaders: false });
const SocialMutationLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 120, standardHeaders: DraftStandardHeaders, legacyHeaders: false });

export function RegisterSocialRoutes(app, dependencies) {
  RegisterProfileRoutes(app, dependencies);
  RegisterFriendRoutes(app, dependencies);
  RegisterSocialRecommendationRoutes(app, dependencies);
}

function RegisterProfileRoutes(app, dependencies) {
  app.get(ProfileRoute, async (request, response) => await HandleGetProfile(request, response, dependencies));
  app.put(ProfileRoute, SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleUpdateProfile(request, response, dependencies));
  app.put(ProfileUsernameRoute, SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleClaimUsername(request, response, dependencies));
  app.put(ProfileAvatarRoute, SocialMutationLimiter, RequireCsrf, express.raw({ type: AvatarMediaTypes, limit: MaximumAvatarBytes }), async (request, response) => await HandlePutAvatar(request, response, dependencies));
  app.delete(ProfileAvatarRoute, SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleDeleteAvatar(request, response, dependencies));
  app.get("/api/avatars/:userId", async (request, response) => await HandleGetAvatar(request, response, dependencies));
}

function RegisterFriendRoutes(app, dependencies) {
  app.get("/api/friends", async (request, response) => await HandleListFriends(request, response, dependencies));
  app.get("/api/friends/search", SearchLimiter, async (request, response) => await HandleSearchFriends(request, response, dependencies));
  app.post("/api/friends/requests", SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleFriendRequest(request, response, dependencies));
  app.put("/api/friends/requests/:relationshipId/accept", SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleAcceptFriend(request, response, dependencies));
  app.delete("/api/friends/relationships/:relationshipId", SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleDeleteFriend(request, response, dependencies));
  app.post("/api/friends/:userId/block", SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleBlockFriend(request, response, dependencies));
}

function RegisterSocialRecommendationRoutes(app, dependencies) {
  app.post("/api/social/title-context", RequireCsrf, async (request, response) => await HandleTitleContext(request, response, dependencies));
  app.post("/api/social/share", SocialMutationLimiter, RequireCsrf, async (request, response) => await HandleShareRecommendation(request, response, dependencies));
}

async function HandleGetProfile(request, response, dependencies) {
  const profile = await dependencies.store.GetProfile(request.session.userId);
  response.json({ ok: true, profile });
}

async function HandleUpdateProfile(request, response, dependencies) {
  const parsed = ProfileSchema.safeParse(request.body);
  if (!parsed.success)
    return InvalidSocialRequest(response, "Enter valid profile settings.");
  const profile = await dependencies.store.UpdateProfile(request.session.userId, parsed.data);
  response.json({ ok: true, profile });
}

async function HandleClaimUsername(request, response, dependencies) {
  const parsed = UsernameSchema.safeParse(request.body);
  if (!parsed.success)
    return InvalidSocialRequest(response, parsed.error.issues[0]?.message || "Enter a valid username.");
  try {
    const profile = await dependencies.store.ClaimHandle(request.session.userId, parsed.data.handle);
    if (!profile)
      return response.status(409).json({ ok: false, code: "USERNAME_LOCKED", error: "Your username has already been chosen and cannot be changed." });
    response.json({ ok: true, profile });
  } catch (error) {
    if (error?.code === "23505")
      return response.status(409).json({ ok: false, code: "USERNAME_UNAVAILABLE", error: "That username is already in use." });
    throw error;
  }
}

async function HandlePutAvatar(request, response, dependencies) {
  const contentType = String(request.get(ContentTypeHeader) || "").split(";")[0].toLowerCase();
  const imageData = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  if (!IsValidAvatar(contentType, imageData))
    return InvalidSocialRequest(response, "Choose a JPEG, PNG, or WebP image no larger than 1 MB.");
  const avatarVersion = await dependencies.store.PutAvatar(request.session.userId, contentType, imageData);
  response.json({ ok: true, avatarVersion, avatarUrl: `/api/avatars/${request.session.userId}?v=${avatarVersion}` });
}

async function HandleDeleteAvatar(request, response, dependencies) {
  const avatarVersion = await dependencies.store.DeleteAvatar(request.session.userId);
  response.json({ ok: true, avatarVersion, avatarUrl: "" });
}

async function HandleGetAvatar(request, response, dependencies) {
  const userId = UserIdSchema.safeParse(request.params.userId);
  if (!userId.success)
    return response.status(404).end();
  const avatar = await dependencies.store.GetAvatar(request.session.userId, userId.data);
  if (!avatar)
    return response.status(404).end();
  response.set(ContentTypeHeader, avatar.content_type);
  response.set("cache-control", "private, max-age=31536000, immutable");
  response.send(avatar.image_data);
}

async function HandleListFriends(request, response, dependencies) {
  const relationships = await dependencies.store.ListFriendships(request.session.userId);
  response.json({ ok: true, ...relationships });
}

async function HandleSearchFriends(request, response, dependencies) {
  const parsed = SearchSchema.safeParse(request.query);
  if (!parsed.success)
    return InvalidSocialRequest(response, "Enter at least two characters.");
  const results = await dependencies.store.SearchUsers(request.session.userId, parsed.data.q);
  response.json({ ok: true, results });
}

async function HandleFriendRequest(request, response, dependencies) {
  const parsed = FriendRequestSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.userId === request.session.userId)
    return InvalidSocialRequest(response, "Choose another Rapid Rater user.");
  const relationship = await dependencies.store.CreateFriendRequest(request.session.userId, parsed.data.userId);
  if (!relationship || relationship.status === "blocked")
    return response.status(409).json({ ok: false, code: "FRIEND_REQUEST_UNAVAILABLE", error: "That friend request is unavailable." });
  response.status(relationship.status === "pending" ? 201 : 200).json({ ok: true, relationship });
}

async function HandleAcceptFriend(request, response, dependencies) {
  const relationshipId = UserIdSchema.safeParse(request.params.relationshipId);
  if (!relationshipId.success)
    return InvalidSocialRequest(response, "That friend request is invalid.");
  const accepted = await dependencies.store.AcceptFriendRequest(request.session.userId, relationshipId.data);
  if (!accepted)
    return response.status(404).json({ ok: false, code: "FRIEND_REQUEST_NOT_FOUND", error: "That friend request is no longer available." });
  response.json({ ok: true, accepted: true });
}

async function HandleDeleteFriend(request, response, dependencies) {
  const relationshipId = UserIdSchema.safeParse(request.params.relationshipId);
  if (!relationshipId.success)
    return InvalidSocialRequest(response, "That friendship is invalid.");
  const removed = await dependencies.store.DeleteFriendship(request.session.userId, relationshipId.data);
  response.json({ ok: true, removed });
}

async function HandleBlockFriend(request, response, dependencies) {
  const userId = UserIdSchema.safeParse(request.params.userId);
  if (!userId.success || userId.data === request.session.userId)
    return InvalidSocialRequest(response, "That user cannot be blocked.");
  const blocked = await dependencies.store.BlockUser(request.session.userId, userId.data);
  if (!blocked)
    return response.status(404).json({ ok: false, code: "USER_NOT_FOUND", error: "That user was not found." });
  response.json({ ok: true, blocked: true });
}

async function HandleTitleContext(request, response, dependencies) {
  const parsed = SocialContextSchema.safeParse(request.body);
  if (!parsed.success)
    return InvalidSocialRequest(response, "Choose valid movie or TV titles.");
  const titleIds = [...new Set(parsed.data.titleIds)];
  const titles = await dependencies.store.GetSocialTitleContext(request.session.userId, parsed.data.mediaType, titleIds);
  response.json({ ok: true, titles });
}

async function HandleShareRecommendation(request, response, dependencies) {
  const parsed = ShareSchema.safeParse(request.body);
  if (!parsed.success)
    return InvalidSocialRequest(response, "Choose a valid title and at least one friend.");
  const item = await ReadCanonicalRecommendation(dependencies, parsed.data.mediaType, parsed.data.ttId);
  if (!item)
    return response.status(404).json({ ok: false, code: "TITLE_NOT_FOUND", error: "That title is not in the selected catalog." });
  const results = await dependencies.store.ShareRecommendation(request.session.userId, [...new Set(parsed.data.recipientIds)], item, parsed.data.mediaType);
  await NotifyDeliveredRecommendations(dependencies, results, parsed.data.mediaType);
  response.json({ ok: true, recommendation: item, results });
}

async function ReadCanonicalRecommendation(dependencies, mediaType, ttId) {
  const pool = mediaType === "movie" ? await dependencies.readMoviePool(dependencies.rootPath) : await dependencies.readTitlePool(dependencies.rootPath, mediaType);
  const title = pool.titles?.find((item) => item.ttId === ttId);
  if (!title)
    return null;
  return NormalizeRecommendationItem({ ...title, addedAt: new Date().toISOString() });
}

async function NotifyDeliveredRecommendations(dependencies, results, mediaType) {
  if (!dependencies.onRecommendationDelivered)
    return;
  const recipients = results.filter((item) => item.status === "added").map((item) => item.recipientId);
  for (const recipientId of recipients)
    await dependencies.onRecommendationDelivered(recipientId, mediaType);
}

function IsValidAvatar(contentType, imageData) {
  if (!imageData.length || imageData.length > MaximumAvatarBytes)
    return false;
  if (contentType === JpegMediaType)
    return imageData[0] === 0xff && imageData[1] === 0xd8 && imageData[2] === 0xff;
  if (contentType === PngMediaType)
    return imageData.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType !== WebpMediaType)
    return false;
  const hasRiffSignature = imageData.subarray(0, 4).toString(AsciiEncoding) === "RIFF";
  const hasWebpSignature = imageData.subarray(8, 12).toString(AsciiEncoding) === "WEBP";
  return hasRiffSignature && hasWebpSignature;
}

function InvalidSocialRequest(response, error) {
  return response.status(422).json({ ok: false, code: "INVALID_SOCIAL_REQUEST", error });
}
