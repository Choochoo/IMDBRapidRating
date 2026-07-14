import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { UserPreferences, UserSecrets, Users, UserStates } from "./db/schema.mjs";
import { ReadDatabaseSchema } from "./db/config.mjs";
import { DecryptSecret, EncryptSecret } from "./security/secrets.mjs";

export function CreateAccountStore({ db, pool }) {
  return {
    async findUserByUsername(username) {
      const rows = await db.select().from(Users).where(sql`lower(${Users.username}) = ${NormalizeUsername(username)}`).limit(1);
      return rows[0] || null;
    },

    async findUserById(id) {
      const rows = await db.select().from(Users).where(eq(Users.id, id)).limit(1);
      return rows[0] || null;
    },

    async createUser({ username, displayName, passwordHash }) {
      const now = new Date();
      const user = { id: randomUUID(), username: NormalizeUsername(username), displayName, passwordHash, createdAt: now, updatedAt: now };
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

function NormalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function Qualified(table) {
  const schema = ReadDatabaseSchema();
  return `"${schema}"."${table}"`;
}
