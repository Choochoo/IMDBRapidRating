import { integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { ReadDatabaseSchema } from "./config.mjs";

export const AppSchema = pgSchema(ReadDatabaseSchema());

export const Users = AppSchema.table("users", {
  id: uuid("id").primaryKey(),
  username: varchar("username", { length: 160 }).notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("users_username_unique").on(table.username)]);

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

export const UserSecrets = AppSchema.table("user_secrets", {
  userId: uuid("user_id").notNull().references(() => Users.id, { onDelete: "cascade" }),
  secretType: varchar("secret_type", { length: 32 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("user_secrets_user_type_unique").on(table.userId, table.secretType)]);
