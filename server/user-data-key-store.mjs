import { eq } from "drizzle-orm";
import { UserDataKeys } from "./db/schema.mjs";
import { GenerateDataKey } from "./security/envelope-secrets.mjs";

export function CreateUserDataKeyStore(db, keyWrapper) {
  return {
    GetOrCreateKey: async (userId) => await GetOrCreateKey(db, keyWrapper, userId),
    ReadKey: async (userId) => await ReadKey(db, keyWrapper, userId)
  };
}

async function GetOrCreateKey(db, keyWrapper, userId) {
  const existing = await ReadRecord(db, userId);
  if (existing)
    return await keyWrapper.UnwrapKey(existing);
  return await CreateKey(db, keyWrapper, userId);
}

async function ReadKey(db, keyWrapper, userId) {
  const record = await ReadRecord(db, userId);
  if (!record)
    throw new Error("The user envelope key is missing.");
  return await keyWrapper.UnwrapKey(record);
}

async function CreateKey(db, keyWrapper, userId) {
  const dataKey = GenerateDataKey();
  const wrapped = await keyWrapper.WrapKey(dataKey);
  const created = await InsertRecord(db, userId, wrapped);
  if (created)
    return dataKey;
  return await ReadKey(db, keyWrapper, userId);
}

async function InsertRecord(db, userId, wrapped) {
  const now = new Date();
  const values = { userId, ...wrapped, createdAt: now, updatedAt: now };
  const rows = await db.insert(UserDataKeys).values(values).onConflictDoNothing({ target: UserDataKeys.userId }).returning();
  return rows[0] || null;
}

async function ReadRecord(db, userId) {
  const rows = await db.select().from(UserDataKeys).where(eq(UserDataKeys.userId, userId)).limit(1);
  return rows[0] || null;
}
