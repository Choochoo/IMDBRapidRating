import { bigserial, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { ReadDatabaseSchema } from "./config.mjs";

export const AppSchema = pgSchema(ReadDatabaseSchema());

export const Users = AppSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const UserPreferences = AppSchema.table("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => Users.id, { onDelete: "cascade" }),
  openAiModel: varchar("open_ai_model", { length: 160 }).notNull().default(""),
  openAiModelLag: integer("open_ai_model_lag").notNull().default(2),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const UserStates = AppSchema.table("user_states", {
  userId: uuid("user_id").primaryKey().references(() => Users.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull().default({}),
  ratingsCsv: text("ratings_csv").notNull().default(""),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const RecommendationQueue = AppSchema.table("recommendation_queue", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  mediaType: varchar("media_type", { length: 16 }).notNull().default("movie"),
  itemKey: text("item_key").notNull(),
  ttId: varchar("tt_id", { length: 32 }).notNull().default(""),
  title: text("title").notNull(),
  releaseYear: integer("release_year"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("recommendation_queue_user_media_item_unique").on(table.userId, table.mediaType, table.itemKey)]);

export const RaterQueues = AppSchema.table("rater_queues", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  mediaType: varchar("media_type", { length: 16 }).notNull().default("movie"),
  poolVersion: varchar("pool_version", { length: 64 }).notNull(),
  seed: varchar("seed", { length: 128 }).notNull(),
  queueIds: jsonb("queue_ids").notNull().default([]),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [primaryKey({ columns: [table.userId, table.mediaType] })]);

export const RaterActions = AppSchema.table("rater_actions", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  actionId: uuid("action_id").notNull(),
  mediaType: varchar("media_type", { length: 16 }).notNull().default("movie"),
  kind: varchar("kind", { length: 32 }).notNull(),
  ttId: varchar("tt_id", { length: 32 }).notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("rater_actions_user_action_unique").on(table.userId, table.actionId)]);

export const TitleMetadataCache = AppSchema.table("title_metadata_cache", {
  ttId: varchar("tt_id", { length: 32 }).notNull(),
  mediaType: varchar("media_type", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [primaryKey({ columns: [table.ttId, table.mediaType] })]);

export const UserSecrets = AppSchema.table("user_secrets", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  secretType: varchar("secret_type", { length: 32 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("user_secrets_user_type_unique").on(table.userId, table.secretType)]);
