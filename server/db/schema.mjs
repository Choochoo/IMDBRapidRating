import { bigserial, boolean, integer, jsonb, numeric, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ReadDatabaseSchema } from "./config.mjs";
import { DefaultKeyboardShortcuts } from "../../shared/keyboard-shortcuts.js";
import { DefaultHelpPreferences } from "../../shared/help-preferences.js";

export const AppSchema = pgSchema(ReadDatabaseSchema());

const IdColumn = "id";
const UserIdColumn = "user_id";
const MediaTypeColumn = "media_type";
const TitleIdColumn = "tt_id";
const PayloadColumn = "payload";
const StatusColumn = "status";
const RevisionColumn = "revision";
const CreatedAtColumn = "created_at";
const UpdatedAtColumn = "updated_at";
const CascadeDeleteAction = "cascade";
const MovieMediaType = "movie";
const NumberMode = "number";
const InitialRequestsPerSecond = "10";

const UsersColumns = {
  id: uuid(IdColumn).primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildUsersIndexes(table) {
  return {
    emailUnique: uniqueIndex("users_email_unique").on(table.email)
  };
}

export const Users = AppSchema.table("users", UsersColumns, BuildUsersIndexes);

const UserProfilesColumns = {
  userId: uuid(UserIdColumn).primaryKey().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  handle: varchar("handle", { length: 32 }).notNull(),
  handleChosen: boolean("handle_chosen").notNull().default(false),
  displayName: varchar("display_name", { length: 80 }).notNull().default("Rapid Rater User"),
  searchable: boolean("searchable").notNull().default(true),
  shareRatingsWithFriends: boolean("share_ratings_with_friends").notNull().default(true),
  showFriendRatings: boolean("show_friend_ratings").notNull().default(true),
  avatarVersion: integer("avatar_version").notNull().default(0),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildUserProfilesIndexes(table) {
  return {
    handleUnique: uniqueIndex("user_profiles_handle_unique").on(sql`lower(${table.handle})`)
  };
}

export const UserProfiles = AppSchema.table("user_profiles", UserProfilesColumns, BuildUserProfilesIndexes);

const UserPreferencesColumns = {
  userId: uuid(UserIdColumn).primaryKey().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  openAiModel: varchar("open_ai_model", { length: 160 }).notNull().default(""),
  openAiModelLag: integer("open_ai_model_lag").notNull().default(2),
  aiBaseUrl: text("ai_base_url").notNull().default(""),
  aiModel: varchar("ai_model", { length: 512 }).notNull().default(""),
  aiConfigured: boolean("ai_configured").notNull().default(false),
  streamingCountry: varchar("streaming_country", { length: 2 }).notNull().default("US"),
  keyboardShortcuts: jsonb("keyboard_shortcuts").notNull().default(DefaultKeyboardShortcuts),
  helpPreferences: jsonb("help_preferences").notNull().default(DefaultHelpPreferences),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

export const UserPreferences = AppSchema.table("user_preferences", UserPreferencesColumns);

const AiConnectionsColumns = {
  id: uuid(IdColumn).primaryKey(),
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  providerId: varchar("provider_id", { length: 32 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  baseUrl: text("base_url").notNull().default(""),
  modelId: varchar("model_id", { length: 512 }).notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  testStatus: varchar("test_status", { length: 24 }).notNull().default("tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildAiConnectionIndexes(table) {
  return {
    oneDefault: uniqueIndex("ai_connections_one_default").on(table.userId).where(sql`${table.isDefault}`)
  };
}

export const AiConnections = AppSchema.table("ai_connections", AiConnectionsColumns, BuildAiConnectionIndexes);

const UserStatesColumns = {
  userId: uuid(UserIdColumn).primaryKey().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  payload: jsonb(PayloadColumn).notNull().default({}),
  ratingsCsv: text("ratings_csv").notNull().default(""),
  revision: integer(RevisionColumn).notNull().default(0),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

export const UserStates = AppSchema.table("user_states", UserStatesColumns);

const RecommendationQueueColumns = {
  id: bigserial(IdColumn, { mode: NumberMode }).primaryKey(),
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  mediaType: varchar(MediaTypeColumn, { length: 16 }).notNull().default(MovieMediaType),
  itemKey: text("item_key").notNull(),
  ttId: varchar(TitleIdColumn, { length: 32 }).notNull().default(""),
  title: text("title").notNull(),
  releaseYear: integer("release_year"),
  payload: jsonb(PayloadColumn).notNull(),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull()
};

function BuildRecommendationQueueIndexes(table) {
  return {
    userMediaItemUnique: uniqueIndex("recommendation_queue_user_media_item_unique").on(table.userId, table.mediaType, table.itemKey)
  };
}

export const RecommendationQueue = AppSchema.table("recommendation_queue", RecommendationQueueColumns, BuildRecommendationQueueIndexes);

const RaterQueuesColumns = {
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  mediaType: varchar(MediaTypeColumn, { length: 16 }).notNull().default(MovieMediaType),
  poolVersion: varchar("pool_version", { length: 64 }).notNull(),
  seed: varchar("seed", { length: 128 }).notNull(),
  queueIds: jsonb("queue_ids").notNull().default([]),
  revision: integer(RevisionColumn).notNull().default(1),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildRaterQueuesIndexes(table) {
  return {
    userMediaPrimaryKey: primaryKey({ columns: [table.userId, table.mediaType] })
  };
}

export const RaterQueues = AppSchema.table("rater_queues", RaterQueuesColumns, BuildRaterQueuesIndexes);

const RaterActionsColumns = {
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  actionId: uuid("action_id").notNull(),
  mediaType: varchar(MediaTypeColumn, { length: 16 }).notNull().default(MovieMediaType),
  kind: varchar("kind", { length: 32 }).notNull(),
  ttId: varchar(TitleIdColumn, { length: 32 }).notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull()
};

function BuildRaterActionsIndexes(table) {
  return {
    userActionUnique: uniqueIndex("rater_actions_user_action_unique").on(table.userId, table.actionId)
  };
}

export const RaterActions = AppSchema.table("rater_actions", RaterActionsColumns, BuildRaterActionsIndexes);

const ImdbRatingJobColumns = {
  id: bigserial(IdColumn, { mode: NumberMode }).primaryKey(),
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  mediaType: varchar(MediaTypeColumn, { length: 16 }).notNull(),
  ttId: varchar(TitleIdColumn, { length: 32 }).notNull(),
  operation: varchar("operation", { length: 16 }).notNull().default("rate"),
  rating: smallint("rating"),
  payload: jsonb(PayloadColumn).notNull().default({}),
  status: varchar(StatusColumn, { length: 24 }).notNull().default("pending"),
  generation: integer("generation").notNull().default(1),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastHttpStatus: integer("last_http_status"),
  lastError: text("last_error").notNull().default(""),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true })
};

const ImdbRatingDispatchColumns = {
  singleton: boolean("singleton").primaryKey().default(true),
  maximumRps: numeric("maximum_rps", { precision: 8, scale: 3 }).notNull().default(InitialRequestsPerSecond),
  currentRps: numeric("current_rps", { precision: 8, scale: 3 }).notNull().default(InitialRequestsPerSecond),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  successStreak: integer("success_streak").notNull().default(0),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildImdbRatingJobIndexes(table) {
  return {
    userMediaTitleUnique: uniqueIndex("imdb_rating_jobs_user_media_title_unique").on(table.userId, table.mediaType, table.ttId)
  };
}

export const ImdbRatingJobs = AppSchema.table("imdb_rating_jobs", ImdbRatingJobColumns, BuildImdbRatingJobIndexes);
export const ImdbRatingDispatchState = AppSchema.table("imdb_rating_dispatch_state", ImdbRatingDispatchColumns);

const TitleMetadataCacheColumns = {
  ttId: varchar(TitleIdColumn, { length: 32 }).notNull(),
  mediaType: varchar(MediaTypeColumn, { length: 16 }).notNull(),
  status: varchar(StatusColumn, { length: 16 }).notNull(),
  tmdbId: integer("tmdb_id"),
  originCountries: jsonb("origin_countries").notNull().default([]),
  originalLanguage: varchar("original_language", { length: 16 }).notNull().default(""),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  posterUrl: text("poster_url").notNull().default(""),
  synopsis: text("synopsis").notNull().default(""),
  actors: jsonb("actors").notNull().default([]),
  trailerUrl: text("trailer_url").notNull().default(""),
  seriesStatus: text("series_status").notNull().default(""),
  seasonCount: integer("season_count").notNull().default(0),
  episodeCount: integer("episode_count").notNull().default(0),
  episodeRuntimeMinutes: integer("episode_runtime_minutes").notNull().default(0),
  metadataSource: varchar("metadata_source", { length: 32 }).notNull().default(""),
  sourcePayload: jsonb("source_payload").notNull().default({}),
  metadataCheckedAt: timestamp("metadata_checked_at", { withTimezone: true }),
  streamingAvailability: jsonb("streaming_availability").notNull().default({}),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildTitleMetadataCacheIndexes(table) {
  return {
    titleMediaPrimaryKey: primaryKey({ columns: [table.ttId, table.mediaType] })
  };
}

export const TitleMetadataCache = AppSchema.table("title_metadata_cache", TitleMetadataCacheColumns, BuildTitleMetadataCacheIndexes);

const UserSecretsColumns = {
  userId: uuid(UserIdColumn).notNull().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  secretType: varchar("secret_type", { length: 80 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

function BuildUserSecretsIndexes(table) {
  return {
    userTypeUnique: uniqueIndex("user_secrets_user_type_unique").on(table.userId, table.secretType)
  };
}

export const UserSecrets = AppSchema.table("user_secrets", UserSecretsColumns, BuildUserSecretsIndexes);

const UserDataKeysColumns = {
  userId: uuid(UserIdColumn).primaryKey().references(() => Users.id, { onDelete: CascadeDeleteAction }),
  wrappedKey: text("wrapped_key").notNull(),
  wrappingKeyId: text("wrapping_key_id").notNull(),
  wrappingAlgorithm: varchar("wrapping_algorithm", { length: 32 }).notNull(),
  createdAt: timestamp(CreatedAtColumn, { withTimezone: true }).notNull(),
  updatedAt: timestamp(UpdatedAtColumn, { withTimezone: true }).notNull()
};

export const UserDataKeys = AppSchema.table("user_data_keys", UserDataKeysColumns);
