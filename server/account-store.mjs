import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { UserPreferences, UserSecrets, Users, UserStates } from "./db/schema.mjs";
import { ReadDatabaseSchema } from "./db/config.mjs";
import { DecryptSecret, EncryptSecret } from "./security/secrets.mjs";
import { CreateRaterQueueStore } from "./rater-queue-store.mjs";
import { NormalizeMediaType, ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

export function CreateAccountStore({ db, pool }) {
  return {
    ...CreateRaterQueueStore(pool),
    async findUserByEmail(email) {
      const rows = await db.select().from(Users).where(sql`lower(${Users.email}) = ${NormalizeEmail(email)}`).limit(1);
      return rows[0] || null;
    },

    async findUserById(id) {
      const rows = await db.select().from(Users).where(eq(Users.id, id)).limit(1);
      return rows[0] || null;
    },

    async createUser({ email, passwordHash }) {
      const now = new Date();
      const id = randomUUID();
      const user = {
        id,
        email: NormalizeEmail(email),
        passwordHash,
        createdAt: now,
        updatedAt: now
      };
      await db.transaction(async (tx) => {
        await tx.insert(Users).values(user);
        await tx.insert(UserPreferences).values({ userId: user.id, updatedAt: now });
        await tx.insert(UserStates).values({ userId: user.id, payload: {}, ratingsCsv: "", revision: 0, updatedAt: now });
      });
      return user;
    },

    async countUsers() {
      const result = await db.select({ count: sql`count(*)::int` }).from(Users);
      return Number(result[0]?.count || 0);
    },

    async getBundle(userId) {
      const [preferences] = await db.select().from(UserPreferences).where(eq(UserPreferences.userId, userId)).limit(1);
      const [state] = await db.select().from(UserStates).where(eq(UserStates.userId, userId)).limit(1);
      const secrets = await db.select({ secretType: UserSecrets.secretType }).from(UserSecrets).where(eq(UserSecrets.userId, userId));
      const configured = new Set(secrets.map((item) => item.secretType));
      return {
        preferences: preferences || { openAiModel: "", openAiModelLag: 2 },
        state: state || { payload: {}, ratingsCsv: "", revision: 0 },
        configured
      };
    },

    async saveState(userId, payload, ratingsCsv, expectedRevision) {
      const result = await pool.query(
        `UPDATE ${Qualified("user_states")} SET payload=$1::jsonb, ratings_csv=$2, revision=revision+1, updated_at=now() WHERE user_id=$3 AND revision=$4 RETURNING revision`,
        [JSON.stringify(payload), ratingsCsv, userId, expectedRevision]
      );
      if (result.rowCount)
        return { ok: true, revision: result.rows[0].revision };
      const current = await pool.query(`SELECT payload, ratings_csv, revision FROM ${Qualified("user_states")} WHERE user_id=$1`, [userId]);
      return { ok: false, current: current.rows[0] || null };
    },

    async recordRating(userId, record, mediaType = record?.mediaType) {
      return await MutateMediaState(pool, userId, mediaType, (state) => ({
        ...state,
        ratings: { ...(state.ratings || {}), [record.ttId]: { ...record, mediaType: NormalizeMediaType(mediaType) } }
      }));
    },

    async deleteRating(userId, ttId, mediaType = "movie") {
      return await MutateMediaState(pool, userId, mediaType, (state) => {
        const ratings = { ...(state.ratings || {}) };
        delete ratings[ttId];
        return { ...state, ratings };
      });
    },

    async listRecommendationQueue(userId, mediaType = "movie") {
      const result = await pool.query(
        `SELECT payload FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND media_type=$2 ORDER BY id`,
        [userId, NormalizeMediaType(mediaType)]
      );
      return result.rows.map((row) => row.payload);
    },

    async appendRecommendationQueue(userId, items, mediaType = "movie") {
      if (!Array.isArray(items) || !items.length)
        return [];
      const key = NormalizeMediaType(mediaType);
      const records = items.map((item) => ({
        itemKey: item.queueKey,
        ttId: item.ttId || "",
        title: item.title,
        year: item.year || null,
        payload: { ...item, mediaType: key }
      }));
      const result = await pool.query(
        `INSERT INTO ${Qualified("recommendation_queue")} (user_id, media_type, item_key, tt_id, title, release_year, payload) SELECT $1, $2, item->>'itemKey', COALESCE(item->>'ttId', ''), item->>'title', NULLIF(item->>'year', '')::integer, item->'payload' FROM jsonb_array_elements($3::jsonb) AS item ON CONFLICT DO NOTHING RETURNING payload`,
        [userId, key, JSON.stringify(records)]
      );
      return result.rows.map((row) => row.payload);
    },

    async removeRecommendation(userId, value, mediaType = "movie") {
      const result = await pool.query(
        `DELETE FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND media_type=$2 AND (item_key=$3 OR ($4 <> '' AND tt_id=$4))`,
        [userId, NormalizeMediaType(mediaType), value.queueKey || "", value.ttId || ""]
      );
      return result.rowCount;
    },

    async excludeRecommendation(userId, exclusion, mediaType = "movie") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const state = await ReadUserState(client, userId);
        const key = NormalizeMediaType(mediaType);
        const media = ReadMediaPayload(state.payload, key);
        const mediaPayload = {
          ...media,
          recommendationExclusions: [...(Array.isArray(media.recommendationExclusions) ? media.recommendationExclusions : []), { ...exclusion, mediaType: key }]
        };
        const updated = await WriteUserState(client, userId, WriteMediaPayload(state.payload, key, mediaPayload));
        await client.query(
          `DELETE FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND media_type=$2 AND (item_key=$3 OR ($4 <> '' AND tt_id=$4))`,
          [userId, key, exclusion.queueKey || "", exclusion.ttId || ""]
        );
        await client.query("COMMIT");
        return Number(updated) || 0;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async savePreferences(userId, preferences) {
      const now = new Date();
      await db.insert(UserPreferences).values({ userId, ...preferences, updatedAt: now })
        .onConflictDoUpdate({ target: UserPreferences.userId, set: { ...preferences, updatedAt: now } });
    },

    async putSecret(userId, secretType, value) {
      const encrypted = EncryptSecret(value, userId, secretType);
      const now = new Date();
      await db.insert(UserSecrets).values({ userId, secretType, ...encrypted, updatedAt: now })
        .onConflictDoUpdate({
          target: [UserSecrets.userId, UserSecrets.secretType],
          set: { ...encrypted, updatedAt: now }
        });
    },

    async deleteSecret(userId, secretType) {
      await db.delete(UserSecrets).where(and(eq(UserSecrets.userId, userId), eq(UserSecrets.secretType, secretType)));
    },

    async getSecret(userId, secretType) {
      const rows = await db.select().from(UserSecrets)
        .where(and(eq(UserSecrets.userId, userId), eq(UserSecrets.secretType, secretType))).limit(1);
      return rows[0] ? DecryptSecret(rows[0], userId, secretType) : "";
    }
  };
}

async function MutateMediaState(pool, userId, mediaType, mutate) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await ReadUserState(client, userId);
    const key = NormalizeMediaType(mediaType);
    const payload = WriteMediaPayload(state.payload, key, mutate(ReadMediaPayload(state.payload, key)));
    const revision = await WriteUserState(client, userId, payload);
    await client.query("COMMIT");
    return revision;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ReadUserState(client, userId) {
  const result = await client.query(`SELECT payload, revision FROM ${Qualified("user_states")} WHERE user_id=$1 FOR UPDATE`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function WriteUserState(client, userId, payload) {
  const result = await client.query(
    `UPDATE ${Qualified("user_states")} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`,
    [userId, JSON.stringify(payload)]
  );
  return Number(result.rows[0]?.revision) || 0;
}

function NormalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function Qualified(table) {
  const schema = ReadDatabaseSchema();
  return `"${schema}"."${table}"`;
}
