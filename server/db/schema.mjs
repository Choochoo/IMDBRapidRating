import { bigserial, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
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
  itemKey: text("item_key").notNull(),
  ttId: varchar("tt_id", { length: 32 }).notNull().default(""),
  title: text("title").notNull(),
  releaseYear: integer("release_year"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("recommendation_queue_user_item_unique").on(table.userId, table.itemKey)]);

export const RaterQueues = AppSchema.table("rater_queues", {
  userId: uuid("user_id").primaryKey().references(() => Users.id, { onDelete: "cascade" }),
  poolVersion: varchar("pool_version", { length: 64 }).notNull(),
  seed: varchar("seed", { length: 128 }).notNull(),
  queueIds: jsonb("queue_ids").notNull().default([]),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const RaterActions = AppSchema.table("rater_actions", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  actionId: uuid("action_id").notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  ttId: varchar("tt_id", { length: 32 }).notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("rater_actions_user_action_unique").on(table.userId, table.actionId)]);

export const UserSecrets = AppSchema.table("user_secrets", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  secretType: varchar("secret_type", { length: 32 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("user_secrets_user_type_unique").on(table.userId, table.secretType)]);
