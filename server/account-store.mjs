import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { UserPreferences, UserProfiles, UserSecrets, Users, UserStates } from "./db/schema.mjs";
import { Qualified, RunTransaction } from "./db/transaction.mjs";
import { CreateSecretProtector } from "./security/secret-protector.mjs";
import { CreateRaterQueueStore } from "./rater-queue-store.mjs";
import { CreateImdbRatingJobStore, UpsertPendingImdbJobs } from "./imdb-rating-job-store.mjs";
import { NormalizeMediaType, ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";
import { DefaultStreamingCountry } from "../shared/streaming-country.js";
import { CreateSocialStore } from "./social-store.mjs";
import { DefaultKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";
import { BuildDefaultHelpPreferences } from "../shared/help-preferences.js";

const RecommendationQueueTable = "recommendation_queue";
const UserStatesTable = "user_states";
const MovieMediaType = "movie";

export function CreateAccountStore({ db, pool, secretProtector = CreateSecretProtector({ db }) }) {
  return {
    ...CreateRaterQueueStore(pool),
    ...CreateImdbRatingJobStore(pool),
    ...CreateSocialStore(pool),
    ...CreateUserMethods(db),
    ...CreateStateMethods(pool),
    ...CreateRecommendationMethods(pool),
    ...CreatePreferenceMethods(db),
    ...CreateSecretMethods(db, secretProtector)
  };
}

function CreateUserMethods(db) {
  return {
    findUserByEmail: async (email) => await FindUserByEmail(db, email),
    findUserById: async (id) => await FindUserById(db, id),
    createUser: async ({ email, passwordHash, handle }) => await CreateUser(db, email, passwordHash, handle),
    countUsers: async () => await CountUsers(db),
    getBundle: async (userId) => await GetUserBundle(db, userId)
  };
}

async function FindUserByEmail(db, email) {
  const rows = await db.select().from(Users).where(sql`lower(${Users.email}) = ${NormalizeEmail(email)}`).limit(1);
  return rows[0] || null;
}

async function FindUserById(db, id) {
  const rows = await db.select().from(Users).where(eq(Users.id, id)).limit(1);
  return rows[0] || null;
}

async function CreateUser(db, email, passwordHash, handle) {
  const user = BuildUser(email, passwordHash);
  await db.transaction(async (tx) => await InsertUser(tx, user, handle));
  return user;
}

function BuildUser(email, passwordHash) {
  const now = new Date();
  return {
    id: randomUUID(),
    email: NormalizeEmail(email),
    passwordHash,
    createdAt: now,
    updatedAt: now
  };
}

async function InsertUser(tx, user, handle) {
  await tx.insert(Users).values(user);
  await tx.insert(UserProfiles).values(BuildInitialProfile(user, handle));
  await tx.insert(UserPreferences).values({ userId: user.id, updatedAt: user.createdAt });
  await tx.insert(UserStates).values({ userId: user.id, payload: {}, ratingsCsv: "", revision: 0, updatedAt: user.createdAt });
}

async function CountUsers(db) {
  const result = await db.select({ count: sql`count(*)::int` }).from(Users);
  return Number(result[0]?.count || 0);
}

async function GetUserBundle(db, userId) {
  const preferences = await ReadUserPreferences(db, userId);
  const [state] = await db.select().from(UserStates).where(eq(UserStates.userId, userId)).limit(1);
  const configured = await ReadConfiguredSecrets(db, userId);
  return {
    preferences,
    state: state || { payload: {}, ratingsCsv: "", revision: 0 },
    configured
  };
}

async function ReadConfiguredSecrets(db, userId) {
  const secrets = await db.select({ secretType: UserSecrets.secretType }).from(UserSecrets).where(eq(UserSecrets.userId, userId));
  return new Set(secrets.map((item) => item.secretType));
}

function CreateStateMethods(pool) {
  return {
    saveState: async (userId, payload, ratingsCsv, expectedRevision) => await RunTransaction(pool, async (client) => await SaveStateAndPendingJobs(client, userId, payload, ratingsCsv, expectedRevision)),
    recordRating: async (userId, record, mediaType = record?.mediaType) => await RecordRating(pool, userId, record, mediaType),
    deleteRating: async (userId, ttId, mediaType = MovieMediaType) => await DeleteRating(pool, userId, ttId, mediaType)
  };
}

async function RecordRating(pool, userId, record, mediaType) {
  const update = (state) => BuildStateWithRating(state, record, mediaType);
  return await MutateMediaState(pool, userId, mediaType, update);
}

async function DeleteRating(pool, userId, ttId, mediaType) {
  const update = (state) => BuildStateWithoutRating(state, ttId);
  return await MutateMediaState(pool, userId, mediaType, update);
}

function BuildStateWithRating(state, record, mediaType) {
  const ratings = { ...(state.ratings || {}), [record.ttId]: { ...record, mediaType: NormalizeMediaType(mediaType) } };
  return { ...state, ratings };
}

function BuildStateWithoutRating(state, ttId) {
  const ratings = { ...(state.ratings || {}) };
  delete ratings[ttId];
  return { ...state, ratings };
}

function CreateRecommendationMethods(pool) {
  return {
    listRecommendationQueue: async (userId, mediaType = MovieMediaType) => await ListRecommendationQueue(pool, userId, mediaType),
    appendRecommendationQueue: async (userId, items, mediaType = MovieMediaType) => await AppendRecommendationQueue(pool, userId, items, mediaType),
    removeRecommendation: async (userId, value, mediaType = MovieMediaType) => await DeleteRecommendation(pool, userId, value, NormalizeMediaType(mediaType)),
    excludeRecommendation: async (userId, exclusion, mediaType = MovieMediaType) => await RunTransaction(pool, async (client) => await ExcludeRecommendation(client, userId, exclusion, mediaType))
  };
}

async function ListRecommendationQueue(pool, userId, mediaType) {
  const result = await pool.query(`SELECT payload FROM ${Qualified(RecommendationQueueTable)} WHERE user_id=$1 AND media_type=$2 ORDER BY id`, [userId, NormalizeMediaType(mediaType)]);
  return result.rows.map((row) => row.payload);
}

async function AppendRecommendationQueue(pool, userId, items, mediaType) {
  if (!Array.isArray(items) || !items.length)
    return [];
  const key = NormalizeMediaType(mediaType);
  const records = BuildRecommendationRecords(items, key);
  const result = await pool.query(`INSERT INTO ${Qualified(RecommendationQueueTable)} (user_id, media_type, item_key, tt_id, title, release_year, payload) SELECT $1, $2, item->>'itemKey', COALESCE(item->>'ttId', ''), item->>'title', NULLIF(item->>'year', '')::integer, item->'payload' FROM jsonb_array_elements($3::jsonb) AS item ON CONFLICT DO NOTHING RETURNING payload`, [userId, key, JSON.stringify(records)]);
  return result.rows.map((row) => row.payload);
}

function BuildRecommendationRecords(items, mediaType) {
  return items.map((item) => BuildRecommendationRecord(item, mediaType));
}

function BuildRecommendationRecord(item, mediaType) {
  return {
    itemKey: item.queueKey,
    ttId: item.ttId || "",
    title: item.title,
    year: item.year || null,
    payload: { ...item, mediaType }
  };
}

function CreatePreferenceMethods(db) {
  return {
    getPreferences: async (userId) => await ReadUserPreferences(db, userId),
    savePreferences: async (userId, preferences) => await SavePreferences(db, userId, preferences)
  };
}

async function SavePreferences(db, userId, preferences) {
  const now = new Date();
  await db.insert(UserPreferences).values({ userId, ...preferences, updatedAt: now }).onConflictDoUpdate({ target: UserPreferences.userId, set: { ...preferences, updatedAt: now } });
}

function CreateSecretMethods(db, secretProtector) {
  return {
    putSecret: async (userId, secretType, value) => await PutSecret(db, secretProtector, userId, secretType, value),
    deleteSecret: async (userId, secretType) => await DeleteSecret(db, userId, secretType),
    getSecret: async (userId, secretType) => await GetSecret(db, secretProtector, userId, secretType)
  };
}

async function PutSecret(db, secretProtector, userId, secretType, value) {
  const encrypted = await secretProtector.Encrypt(value, userId, secretType);
  const now = new Date();
  await db.insert(UserSecrets).values({ userId, secretType, ...encrypted, updatedAt: now }).onConflictDoUpdate({ target: [UserSecrets.userId, UserSecrets.secretType], set: { ...encrypted, updatedAt: now } });
}

async function DeleteSecret(db, userId, secretType) {
  await db.delete(UserSecrets).where(and(eq(UserSecrets.userId, userId), eq(UserSecrets.secretType, secretType)));
}

async function GetSecret(db, secretProtector, userId, secretType) {
  const rows = await db.select().from(UserSecrets).where(and(eq(UserSecrets.userId, userId), eq(UserSecrets.secretType, secretType))).limit(1);
  return rows[0] ? await secretProtector.Decrypt(rows[0], userId, secretType) : "";
}

async function MutateMediaState(pool, userId, mediaType, mutate) {
  return await RunTransaction(pool, async (client) => await MutateMediaStateTransaction(client, userId, mediaType, mutate));
}

async function MutateMediaStateTransaction(client, userId, mediaType, mutate) {
  const state = await ReadUserState(client, userId);
  const key = NormalizeMediaType(mediaType);
  const media = mutate(ReadMediaPayload(state.payload, key));
  return await WriteUserState(client, userId, WriteMediaPayload(state.payload, key, media));
}

async function ExcludeRecommendation(client, userId, exclusion, mediaType) {
  const state = await ReadUserState(client, userId);
  const key = NormalizeMediaType(mediaType);
  const media = ReadMediaPayload(state.payload, key);
  const exclusions = Array.isArray(media.recommendationExclusions) ? media.recommendationExclusions : [];
  const mediaPayload = { ...media, recommendationExclusions: [...exclusions, { ...exclusion, mediaType: key }] };
  const updated = await WriteUserState(client, userId, WriteMediaPayload(state.payload, key, mediaPayload));
  await DeleteRecommendation(client, userId, exclusion, key);
  return Number(updated) || 0;
}

async function DeleteRecommendation(client, userId, value, mediaType) {
  const result = await client.query(`DELETE FROM ${Qualified(RecommendationQueueTable)} WHERE user_id=$1 AND media_type=$2 AND (item_key=$3 OR ($4 <> '' AND tt_id=$4))`, [userId, mediaType, value.queueKey || "", value.ttId || ""]);
  return result.rowCount;
}

async function SaveStateAndPendingJobs(client, userId, payload, ratingsCsv, expectedRevision) {
  const result = await client.query(`UPDATE ${Qualified(UserStatesTable)} SET payload=$1::jsonb, ratings_csv=$2, revision=revision+1, updated_at=now() WHERE user_id=$3 AND revision=$4 RETURNING revision`, [JSON.stringify(payload), ratingsCsv, userId, expectedRevision]);
  if (!result.rowCount)
    return await ReadStateConflict(client, userId);
  await UpsertPendingImdbJobs(client, userId, payload);
  return { ok: true, revision: result.rows[0].revision };
}

async function ReadStateConflict(client, userId) {
  const current = await client.query(`SELECT payload, ratings_csv, revision FROM ${Qualified(UserStatesTable)} WHERE user_id=$1`, [userId]);
  return { ok: false, current: current.rows[0] || null };
}

async function ReadUserState(client, userId) {
  const result = await client.query(`SELECT payload, revision FROM ${Qualified(UserStatesTable)} WHERE user_id=$1 FOR UPDATE`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function WriteUserState(client, userId, payload) {
  const result = await client.query(`UPDATE ${Qualified(UserStatesTable)} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`, [userId, JSON.stringify(payload)]);
  return Number(result.rows[0]?.revision) || 0;
}

async function ReadUserPreferences(db, userId) {
  const [preferences] = await db.select().from(UserPreferences).where(eq(UserPreferences.userId, userId)).limit(1);
  return preferences || BuildDefaultPreferences();
}

function BuildDefaultPreferences() {
  return {
    aiBaseUrl: "",
    aiModel: "",
    aiConfigured: false,
    openAiModel: "",
    openAiModelLag: 2,
    streamingCountry: DefaultStreamingCountry,
    keyboardShortcuts: DefaultKeyboardShortcuts,
    helpPreferences: BuildDefaultHelpPreferences()
  };
}

function NormalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function BuildInitialProfile(user, handle) {
  return {
    userId: user.id,
    handle,
    handleChosen: true,
    displayName: "Rapid Rater User",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

