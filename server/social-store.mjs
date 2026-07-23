import { randomUUID } from "node:crypto";
import { RunTransaction, Qualified } from "./db/transaction.mjs";
import { NormalizeMediaType, ReadMediaPayload } from "../shared/media.js";
import { SameRecommendation } from "./recommendation-queue.mjs";

const AcceptedStatus = "accepted";
const BlockedStatus = "blocked";
const PendingStatus = "pending";
const RatedStatus = "rated";
const FriendshipsTable = "friendships";
const RecommendationQueueTable = "recommendation_queue";
const RecommendationSharesTable = "recommendation_shares";
const UserAvatarsTable = "user_avatars";
const UserProfilesTable = "user_profiles";
const UserStatesTable = "user_states";
const UsersTable = "users";

export function CreateSocialStore(pool) {
  return {
    ...CreateProfileMethods(pool),
    ...CreateFriendMethods(pool),
    ...CreateRecommendationMethods(pool)
  };
}

function CreateProfileMethods(pool) {
  return {
    GetProfile: async (userId) => await GetProfile(pool, userId),
    UpdateProfile: async (userId, profile) => await UpdateProfile(pool, userId, profile),
    ClaimHandle: async (userId, handle) => await ClaimHandle(pool, userId, handle),
    PutAvatar: async (userId, contentType, imageData) => await PutAvatar(pool, userId, contentType, imageData),
    DeleteAvatar: async (userId) => await DeleteAvatar(pool, userId),
    GetAvatar: async (viewerId, userId) => await GetAvatar(pool, viewerId, userId)
  };
}

function CreateFriendMethods(pool) {
  return {
    SearchUsers: async (userId, query) => await SearchUsers(pool, userId, query),
    ListFriendships: async (userId) => await ListFriendships(pool, userId),
    CreateFriendRequest: async (userId, recipientUserId) => await CreateFriendRequest(pool, userId, recipientUserId),
    AcceptFriendRequest: async (userId, relationshipId) => await AcceptFriendRequest(pool, userId, relationshipId),
    DeleteFriendship: async (userId, relationshipId) => await DeleteFriendship(pool, userId, relationshipId),
    BlockUser: async (userId, blockedUserId) => await BlockUser(pool, userId, blockedUserId)
  };
}

function CreateRecommendationMethods(pool) {
  return {
    GetSocialTitleContext: async (userId, mediaType, titleIds) => await GetSocialTitleContext(pool, userId, mediaType, titleIds),
    GetFriendRatings: async (userId, friendIds, mediaTypes) => await GetFriendRatings(pool, userId, friendIds, mediaTypes),
    ShareRecommendation: async (userId, recipientIds, item, mediaType) => await ShareRecommendation(pool, userId, recipientIds, item, mediaType)
  };
}

async function GetProfile(pool, userId) {
  const result = await pool.query(`SELECT user_id, handle, handle_chosen, display_name, searchable, share_ratings_with_friends, show_friend_ratings, avatar_version FROM ${Qualified(UserProfilesTable)} WHERE user_id=$1`, [userId]);
  return result.rows[0] ? BuildOwnProfile(result.rows[0]) : null;
}

async function UpdateProfile(pool, userId, profile) {
  const result = await pool.query(`UPDATE ${Qualified(UserProfilesTable)} SET display_name=$2, searchable=$3, share_ratings_with_friends=$4, show_friend_ratings=$5, updated_at=now() WHERE user_id=$1 RETURNING user_id, handle, handle_chosen, display_name, searchable, share_ratings_with_friends, show_friend_ratings, avatar_version`, [userId, profile.displayName, profile.searchable, profile.shareRatingsWithFriends, profile.showFriendRatings]);
  return result.rows[0] ? BuildOwnProfile(result.rows[0]) : null;
}

async function ClaimHandle(pool, userId, handle) {
  const result = await pool.query(`UPDATE ${Qualified(UserProfilesTable)} SET handle=$2, handle_chosen=true, updated_at=now() WHERE user_id=$1 AND handle_chosen=false RETURNING user_id, handle, handle_chosen, display_name, searchable, share_ratings_with_friends, show_friend_ratings, avatar_version`, [userId, handle]);
  return result.rows[0] ? BuildOwnProfile(result.rows[0]) : null;
}

async function PutAvatar(pool, userId, contentType, imageData) {
  return await RunTransaction(pool, (client) => PutAvatarInTransaction(client, userId, contentType, imageData));
}

async function PutAvatarInTransaction(client, userId, contentType, imageData) {
  await client.query(`INSERT INTO ${Qualified(UserAvatarsTable)} (user_id, content_type, image_data, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (user_id) DO UPDATE SET content_type=EXCLUDED.content_type, image_data=EXCLUDED.image_data, updated_at=now()`, [userId, contentType, imageData]);
  return await AdvanceAvatarVersion(client, userId);
}

async function DeleteAvatar(pool, userId) {
  return await RunTransaction(pool, (client) => DeleteAvatarInTransaction(client, userId));
}

async function DeleteAvatarInTransaction(client, userId) {
  await client.query(`DELETE FROM ${Qualified(UserAvatarsTable)} WHERE user_id=$1`, [userId]);
  return await AdvanceAvatarVersion(client, userId);
}

async function AdvanceAvatarVersion(client, userId) {
  const result = await client.query(`UPDATE ${Qualified(UserProfilesTable)} SET avatar_version=avatar_version+1, updated_at=now() WHERE user_id=$1 RETURNING avatar_version`, [userId]);
  return Number(result.rows[0]?.avatar_version) || 0;
}

async function GetAvatar(pool, viewerId, userId) {
  const result = await pool.query(BuildAvatarSql(), [viewerId, userId]);
  return result.rows[0] || null;
}

function BuildAvatarSql() {
  return `SELECT a.content_type, a.image_data, a.updated_at FROM ${Qualified(UserAvatarsTable)} a JOIN ${Qualified(UserProfilesTable)} p ON p.user_id=a.user_id WHERE a.user_id=$2 AND (a.user_id=$1 OR (NOT EXISTS (SELECT 1 FROM ${Qualified(FriendshipsTable)} blocked WHERE blocked.status='${BlockedStatus}' AND ((blocked.requester_user_id=$1 AND blocked.recipient_user_id=$2) OR (blocked.requester_user_id=$2 AND blocked.recipient_user_id=$1))) AND (p.searchable=true OR EXISTS (SELECT 1 FROM ${Qualified(FriendshipsTable)} accepted WHERE accepted.status='${AcceptedStatus}' AND ((accepted.requester_user_id=$1 AND accepted.recipient_user_id=$2) OR (accepted.requester_user_id=$2 AND accepted.recipient_user_id=$1))))))`;
}

async function SearchUsers(pool, userId, query) {
  const normalized = String(query || "").trim().toLowerCase().replace(/^@/, "");
  const pattern = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const email = normalized.includes("@") ? normalized : "";
  const result = await pool.query(BuildSearchSql(), [userId, pattern, email]);
  return result.rows.map(BuildSearchResult);
}

function BuildSearchSql() {
  return `SELECT p.user_id, p.handle, p.display_name, p.avatar_version, f.id AS relationship_id, f.status, f.requester_user_id=$1 AS outgoing FROM ${Qualified(UserProfilesTable)} p JOIN ${Qualified(UsersTable)} u ON u.id=p.user_id LEFT JOIN ${Qualified(FriendshipsTable)} f ON (f.requester_user_id=$1 AND f.recipient_user_id=p.user_id) OR (f.recipient_user_id=$1 AND f.requester_user_id=p.user_id) WHERE p.user_id<>$1 AND p.handle_chosen=true AND p.searchable=true AND (lower(p.handle) LIKE $2 ESCAPE '\\' OR lower(p.display_name) LIKE $2 ESCAPE '\\' OR ($3<>'' AND lower(u.email)=$3)) AND COALESCE(f.status, '')<>'${BlockedStatus}' ORDER BY CASE WHEN lower(p.handle)=trim(both '%' from $2) THEN 0 ELSE 1 END, lower(p.display_name), lower(p.handle) LIMIT 20`;
}

function BuildSearchResult(row) {
  return {
    profile: BuildPublicProfile(row),
    relationshipId: row.relationship_id || "",
    relationshipStatus: row.status || "none",
    outgoing: row.status === PendingStatus && Boolean(row.outgoing)
  };
}

async function ListFriendships(pool, userId) {
  const result = await pool.query(BuildFriendshipListSql(), [userId]);
  return BuildFriendshipGroups(result.rows, userId);
}

function BuildFriendshipListSql() {
  return `SELECT f.id, f.requester_user_id, f.recipient_user_id, f.status, f.created_at, f.accepted_at, p.user_id, p.handle, p.display_name, p.avatar_version FROM ${Qualified(FriendshipsTable)} f JOIN ${Qualified(UserProfilesTable)} p ON p.user_id=CASE WHEN f.requester_user_id=$1 THEN f.recipient_user_id ELSE f.requester_user_id END WHERE (f.requester_user_id=$1 OR f.recipient_user_id=$1) AND f.status<>'${BlockedStatus}' ORDER BY f.updated_at DESC`;
}

function BuildFriendshipGroups(rows, userId) {
  const groups = { friends: [], incoming: [], outgoing: [], pendingCount: 0 };
  for (const row of rows)
    AddFriendshipGroup(groups, row, userId);
  groups.pendingCount = groups.incoming.length;
  return groups;
}

function AddFriendshipGroup(groups, row, userId) {
  const entry = BuildFriendshipEntry(row);
  if (row.status === AcceptedStatus)
    return groups.friends.push(entry);
  if (row.recipient_user_id === userId)
    return groups.incoming.push(entry);
  groups.outgoing.push(entry);
}

function BuildFriendshipEntry(row) {
  return {
    relationshipId: row.id,
    profile: BuildPublicProfile(row),
    requestedAt: row.created_at,
    acceptedAt: row.accepted_at
  };
}

async function CreateFriendRequest(pool, userId, recipientUserId) {
  const id = randomUUID();
  const result = await pool.query(`INSERT INTO ${Qualified(FriendshipsTable)} (id, requester_user_id, recipient_user_id, status, created_at, updated_at) SELECT $1, $2, u.id, '${PendingStatus}', now(), now() FROM ${Qualified(UsersTable)} u WHERE u.id=$3 ON CONFLICT DO NOTHING RETURNING id, requester_user_id, recipient_user_id, status`, [id, userId, recipientUserId]);
  if (result.rows[0])
    return result.rows[0];
  return await ReadFriendshipBetween(pool, userId, recipientUserId);
}

async function ReadFriendshipBetween(pool, userId, otherUserId) {
  const result = await pool.query(`SELECT id, requester_user_id, recipient_user_id, status FROM ${Qualified(FriendshipsTable)} WHERE (requester_user_id=$1 AND recipient_user_id=$2) OR (requester_user_id=$2 AND recipient_user_id=$1) LIMIT 1`, [userId, otherUserId]);
  return result.rows[0] || null;
}

async function AcceptFriendRequest(pool, userId, relationshipId) {
  const result = await pool.query(`UPDATE ${Qualified(FriendshipsTable)} SET status='${AcceptedStatus}', accepted_at=now(), updated_at=now() WHERE id=$1 AND recipient_user_id=$2 AND status='${PendingStatus}' RETURNING id`, [relationshipId, userId]);
  return Boolean(result.rowCount);
}

async function DeleteFriendship(pool, userId, relationshipId) {
  const result = await pool.query(`DELETE FROM ${Qualified(FriendshipsTable)} WHERE id=$1 AND (requester_user_id=$2 OR recipient_user_id=$2) RETURNING id`, [relationshipId, userId]);
  return Boolean(result.rowCount);
}

async function BlockUser(pool, userId, blockedUserId) {
  return await RunTransaction(pool, (client) => BlockUserInTransaction(client, userId, blockedUserId));
}

async function BlockUserInTransaction(client, userId, blockedUserId) {
  await client.query(`DELETE FROM ${Qualified(FriendshipsTable)} WHERE (requester_user_id=$1 AND recipient_user_id=$2) OR (requester_user_id=$2 AND recipient_user_id=$1)`, [userId, blockedUserId]);
  const result = await client.query(`INSERT INTO ${Qualified(FriendshipsTable)} (id, requester_user_id, recipient_user_id, status, created_at, updated_at) SELECT $1, $2, u.id, '${BlockedStatus}', now(), now() FROM ${Qualified(UsersTable)} u WHERE u.id=$3 RETURNING id`, [randomUUID(), userId, blockedUserId]);
  return Boolean(result.rowCount);
}

async function GetSocialTitleContext(pool, userId, mediaType, titleIds) {
  const key = NormalizeMediaType(mediaType);
  const [ratings, shares] = await Promise.all([ReadFriendRatingRows(pool, userId, key, titleIds), ReadShareRows(pool, userId, key, titleIds)]);
  return BuildTitleContext(titleIds, ratings.rows, shares.rows, userId);
}

async function ReadFriendRatingRows(pool, userId, mediaType, titleIds) {
  return await pool.query(`WITH friend_ids AS (SELECT CASE WHEN requester_user_id=$1 THEN recipient_user_id ELSE requester_user_id END AS user_id FROM ${Qualified(FriendshipsTable)} WHERE status='${AcceptedStatus}' AND (requester_user_id=$1 OR recipient_user_id=$1)) SELECT rating.key AS tt_id, rating.value, p.user_id, p.handle, p.display_name, p.avatar_version FROM friend_ids f JOIN ${Qualified(UserProfilesTable)} p ON p.user_id=f.user_id AND p.share_ratings_with_friends=true JOIN ${Qualified(UserStatesTable)} s ON s.user_id=f.user_id CROSS JOIN LATERAL jsonb_each(COALESCE(s.payload->'media'->($2::text)->'ratings', '{}'::jsonb)) rating WHERE rating.key=ANY($3::text[]) AND rating.value->>'status'='${RatedStatus}' AND rating.value->>'rating'~'^[0-9]+$'`, [userId, mediaType, titleIds]);
}

async function ReadShareRows(pool, userId, mediaType, titleIds) {
  return await pool.query(`SELECT s.tt_id, s.sender_user_id, s.recipient_user_id, sender.user_id AS sender_id, sender.handle AS sender_handle, sender.display_name AS sender_name, sender.avatar_version AS sender_avatar_version, recipient.user_id AS recipient_id, recipient.handle AS recipient_handle, recipient.display_name AS recipient_name, recipient.avatar_version AS recipient_avatar_version FROM ${Qualified(RecommendationSharesTable)} s JOIN ${Qualified(FriendshipsTable)} f ON f.status='${AcceptedStatus}' AND ((f.requester_user_id=s.sender_user_id AND f.recipient_user_id=s.recipient_user_id) OR (f.requester_user_id=s.recipient_user_id AND f.recipient_user_id=s.sender_user_id)) JOIN ${Qualified(UserProfilesTable)} sender ON sender.user_id=s.sender_user_id JOIN ${Qualified(UserProfilesTable)} recipient ON recipient.user_id=s.recipient_user_id WHERE (s.sender_user_id=$1 OR s.recipient_user_id=$1) AND s.media_type=$2 AND s.tt_id=ANY($3::text[])`, [userId, mediaType, titleIds]);
}

function BuildTitleContext(titleIds, ratings, shares, userId) {
  const context = Object.fromEntries(titleIds.map((titleId) => [titleId, { ratings: [], sharedBy: [], sharedWith: [] }]));
  for (const row of ratings)
    context[row.tt_id]?.ratings.push(BuildFriendRating(row));
  for (const row of shares)
    AddShareContext(context[row.tt_id], row, userId);
  return context;
}

function BuildFriendRating(row) {
  return {
    profile: BuildPublicProfile(row),
    rating: Number(row.value?.rating) || 0,
    ratedAt: row.value?.at || ""
  };
}

function AddShareContext(context, row, userId) {
  if (!context)
    return;
  const incoming = row.recipient_user_id === userId;
  const profile = incoming ? BuildShareProfile(row, "sender") : BuildShareProfile(row, "recipient");
  AddUniqueProfile(incoming ? context.sharedBy : context.sharedWith, profile);
}

function BuildShareProfile(row, prefix) {
  const profile = {
    user_id: row[`${prefix}_id`],
    handle: row[`${prefix}_handle`],
    display_name: row[`${prefix}_name`],
    avatar_version: row[`${prefix}_avatar_version`]
  };
  return BuildPublicProfile(profile);
}

function AddUniqueProfile(profiles, profile) {
  if (!profiles.some((item) => item.userId === profile.userId))
    profiles.push(profile);
}

async function GetFriendRatings(pool, userId, friendIds, mediaTypes) {
  if (!friendIds.length || !mediaTypes.length)
    return [];
  const result = await pool.query(BuildFriendRatingsSql(), [userId, friendIds, mediaTypes]);
  return result.rows.map(BuildTasteRating);
}

function BuildFriendRatingsSql() {
  return `WITH accepted AS (SELECT CASE WHEN requester_user_id=$1 THEN recipient_user_id ELSE requester_user_id END AS user_id FROM ${Qualified(FriendshipsTable)} WHERE status='${AcceptedStatus}' AND (requester_user_id=$1 OR recipient_user_id=$1)) SELECT media.media_type, rating.value FROM accepted a JOIN ${Qualified(UserProfilesTable)} p ON p.user_id=a.user_id AND p.share_ratings_with_friends=true JOIN ${Qualified(UserStatesTable)} s ON s.user_id=a.user_id CROSS JOIN unnest($3::text[]) media(media_type) CROSS JOIN LATERAL jsonb_each(COALESCE(s.payload->'media'->media.media_type->'ratings', '{}'::jsonb)) rating WHERE a.user_id=ANY($2::uuid[]) AND rating.value->>'status'='${RatedStatus}' AND rating.value->>'rating'~'^[0-9]+$' LIMIT 1000`;
}

function BuildTasteRating(row) {
  return {
    ...row.value,
    sourceMediaType: row.media_type,
    sourceAudience: "friend"
  };
}

async function ShareRecommendation(pool, userId, recipientIds, item, mediaType) {
  return await RunTransaction(pool, async (client) => await ShareWithRecipients(client, userId, recipientIds, item, NormalizeMediaType(mediaType)));
}

async function ShareWithRecipients(client, userId, recipientIds, item, mediaType) {
  const results = [];
  for (const recipientId of recipientIds)
    results.push(await ShareWithRecipient(client, userId, recipientId, item, mediaType));
  return results;
}

async function ShareWithRecipient(client, userId, recipientId, item, mediaType) {
  const eligibility = await ReadShareEligibility(client, userId, recipientId);
  const disposition = ReadShareDisposition(eligibility, item, mediaType);
  if (disposition)
    return { recipientId, status: disposition };
  await InsertShare(client, userId, recipientId, item.ttId, mediaType);
  const added = await InsertSharedRecommendation(client, recipientId, item, mediaType);
  return { recipientId, status: added ? "added" : "already-saved" };
}

async function ReadShareEligibility(client, userId, recipientId) {
  const result = await client.query(`SELECT s.payload, EXISTS(SELECT 1 FROM ${Qualified(FriendshipsTable)} f WHERE f.status='${AcceptedStatus}' AND ((f.requester_user_id=$1 AND f.recipient_user_id=$2) OR (f.requester_user_id=$2 AND f.recipient_user_id=$1))) AS accepted FROM ${Qualified(UserStatesTable)} s WHERE s.user_id=$2`, [userId, recipientId]);
  return result.rows[0] || { accepted: false, payload: {} };
}

function ReadShareDisposition(eligibility, item, mediaType) {
  if (!eligibility.accepted)
    return "not-friends";
  const media = ReadMediaPayload(eligibility.payload, mediaType);
  if (media.ratings?.[item.ttId]?.status === RatedStatus)
    return "already-rated";
  const exclusions = Array.isArray(media.recommendationExclusions) ? media.recommendationExclusions : [];
  return exclusions.some((value) => SameRecommendation(value, item)) ? "excluded" : "";
}

async function InsertShare(client, userId, recipientId, ttId, mediaType) {
  await client.query(`INSERT INTO ${Qualified(RecommendationSharesTable)} (id, sender_user_id, recipient_user_id, media_type, tt_id, created_at) VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT DO NOTHING`, [randomUUID(), userId, recipientId, mediaType, ttId]);
}

async function InsertSharedRecommendation(client, recipientId, item, mediaType) {
  const payload = { ...item, mediaType, source: "friend-share", why: { tasteMatch: "Shared by a friend.", ratingEvidence: [] } };
  const result = await client.query(`INSERT INTO ${Qualified(RecommendationQueueTable)} (user_id, media_type, item_key, tt_id, title, release_year, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [recipientId, mediaType, item.queueKey, item.ttId, item.title, item.year || null, JSON.stringify(payload)]);
  return Boolean(result.rowCount);
}

function BuildOwnProfile(row) {
  return {
    ...BuildPublicProfile(row),
    handleChosen: Boolean(row.handle_chosen),
    searchable: Boolean(row.searchable),
    shareRatingsWithFriends: Boolean(row.share_ratings_with_friends),
    showFriendRatings: Boolean(row.show_friend_ratings)
  };
}

function BuildPublicProfile(row) {
  const version = Number(row.avatar_version) || 0;
  return {
    userId: row.user_id,
    handle: row.handle || "",
    displayName: row.display_name || "Rapid Rater User",
    avatarVersion: version,
    avatarUrl: version ? `/api/avatars/${row.user_id}?v=${version}` : ""
  };
}
