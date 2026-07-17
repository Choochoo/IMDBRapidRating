import assert from "node:assert/strict";
import test from "node:test";
import { CreateAccountStore } from "../server/account-store.mjs";

test("successful IMDb writes update the matching PostgreSQL rating atomically", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [{ revision: calls.length + 10 }], rowCount: 1 };
    }
  };
  const store = CreateAccountStore({ db: {}, pool });
  const record = { ttId: "tt0107050", status: "rated", rating: 8 };

  const savedRevision = await store.recordRating("user-1", record);
  const deletedRevision = await store.deleteRating("user-1", record.ttId);

  assert.equal(savedRevision, 11);
  assert.equal(deletedRevision, 12);
  assert.match(calls[0].sql, /jsonb_build_object/);
  assert.match(calls[1].sql, /payload->'ratings'.*- \$2::text/);
  assert.deepEqual(calls[0].parameters, ["user-1", record.ttId, JSON.stringify(record)]);
  assert.deepEqual(calls[1].parameters, ["user-1", record.ttId]);
});
