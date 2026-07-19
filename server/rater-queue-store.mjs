import { CreateQueueSeed, QueueSnapshot, ReconcileQueueIds, SameQueueIds } from "./rater-queue.mjs";
import { ReadDatabaseSchema } from "./db/config.mjs";

export function CreateRaterQueueStore(pool) {
  return {
    async getRaterQueue(userId, moviePool) {
      return await WithTransaction(pool, async (client) => {
        let queue = await ReadQueue(client, userId, true);
        const state = await ReadState(client, userId, true);
        const recommendations = await ReadRecommendationIds(client, userId);
        if (!queue)
          queue = await ReadQueue(client, userId, true);
        const seed = String(queue?.seed || CreateQueueSeed());
        const legacyIds = queue ? queue.queue_ids : state.payload?.queueIds;
        const unavailable = [...Object.keys(state.payload?.ratings || {}), ...recommendations];
        const queueIds = ReconcileQueueIds(legacyIds, moviePool.ids, unavailable, seed);
        const changed = !queue || queue.pool_version !== moviePool.version || !SameQueueIds(queue.queue_ids, queueIds);
        if (!queue) {
          queue = (await client.query(
            `INSERT INTO ${Qualified("rater_queues")} (user_id, pool_version, seed, queue_ids, revision, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, 1, now(), now()) RETURNING pool_version, seed, queue_ids, revision`,
            [userId, moviePool.version, seed, JSON.stringify(queueIds)]
          )).rows[0];
        } else if (changed) {
          queue = (await client.query(
            `UPDATE ${Qualified("rater_queues")} SET pool_version=$2, queue_ids=$3::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING pool_version, seed, queue_ids, revision`,
            [userId, moviePool.version, JSON.stringify(queueIds)]
          )).rows[0];
        }
        return { ...QueueSnapshot(queue), changed };
      });
    },

    async commitRaterDecision(userId, decision) {
      return await WithTransaction(pool, async (client) => {
        const duplicate = await ReadAction(client, userId, decision.actionId);
        if (duplicate)
          return await BuildDuplicateResult(client, userId, duplicate);
        const queue = await ReadQueue(client, userId, true);
        const committedDuplicate = await ReadAction(client, userId, decision.actionId);
        if (committedDuplicate)
          return await BuildDuplicateResult(client, userId, committedDuplicate);
        if (!queue)
          return { ok: false, code: "QUEUE_NOT_READY", current: QueueSnapshot(null) };
        const current = QueueSnapshot(queue);
        if (current.revision !== decision.expectedRevision || current.queueIds[0] !== decision.ttId)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const state = await ReadState(client, userId, true);
        const previous = state.payload?.ratings?.[decision.ttId] || null;
        const nextPayload = ApplyDecisionToPayload(state.payload, decision, previous);
        const stateRevision = decision.record
          ? await WriteStatePayload(client, userId, nextPayload)
          : Number(state.revision) || 0;
        if (decision.recommendation)
          await InsertRecommendation(client, userId, decision.recommendation);
        const nextQueue = await WriteQueue(client, userId, current.queueIds.slice(1));
        const result = {
          ok: true,
          duplicate: false,
          stateRevision,
          record: decision.record || null,
          previous,
          recommendation: decision.recommendation || null,
          queue: QueueSnapshot(nextQueue)
        };
        await InsertAction(client, userId, decision, result);
        return result;
      });
    },

    async commitRaterUndo(userId, request) {
      return await WithTransaction(pool, async (client) => {
        const duplicate = await ReadAction(client, userId, request.actionId);
        if (duplicate)
          return await BuildDuplicateResult(client, userId, duplicate);
        const queue = await ReadQueue(client, userId, true);
        const committedDuplicate = await ReadAction(client, userId, request.actionId);
        if (committedDuplicate)
          return await BuildDuplicateResult(client, userId, committedDuplicate);
        const current = QueueSnapshot(queue);
        const state = await ReadState(client, userId, true);
        const history = Array.isArray(state.payload?.history) ? state.payload.history.slice(-200) : [];
        const last = history.at(-1);
        if (!queue || current.revision !== request.expectedRevision || last?.ttId !== request.ttId)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const payload = { ...(state.payload || {}), ratings: { ...(state.payload?.ratings || {}) }, history: history.slice(0, -1) };
        if (last.previous)
          payload.ratings[request.ttId] = last.previous;
        else
          delete payload.ratings[request.ttId];
        const stateRevision = await WriteStatePayload(client, userId, payload);
        const queueIds = last.previous
          ? current.queueIds
          : [request.ttId, ...current.queueIds.filter((ttId) => ttId !== request.ttId)];
        const nextQueue = await WriteQueue(client, userId, queueIds);
        const result = {
          ok: true,
          duplicate: false,
          stateRevision,
          record: last.previous || null,
          previous: state.payload?.ratings?.[request.ttId] || null,
          queue: QueueSnapshot(nextQueue)
        };
        await InsertAction(client, userId, { ...request, kind: "undo" }, result);
        return result;
      });
    },

    async replaceRaterQueue(userId, request, moviePool) {
      return await WithTransaction(pool, async (client) => {
        const queue = await ReadQueue(client, userId, true);
        const current = QueueSnapshot(queue);
        if (!queue || current.revision !== request.expectedRevision)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const state = await ReadState(client, userId, true);
        const recommendations = await ReadRecommendationIds(client, userId);
        const unavailable = [...Object.keys(state.payload?.ratings || {}), ...recommendations];
        const queueIds = ReconcileQueueIds(request.queueIds, moviePool.ids, unavailable, queue.seed);
        const nextQueue = await WriteQueue(client, userId, queueIds, moviePool.version);
        return { ok: true, queue: QueueSnapshot(nextQueue) };
      });
    }
  };
}

function ApplyDecisionToPayload(value, decision, previous) {
  const payload = { ...(value || {}), ratings: { ...(value?.ratings || {}) } };
  payload.ratings[decision.ttId] = decision.record;
  const history = Array.isArray(value?.history) ? value.history.slice(-199) : [];
  payload.history = [...history, { ttId: decision.ttId, previous }];
  return payload;
}

async function BuildDuplicateResult(client, userId, action) {
  const queue = await ReadQueue(client, userId, false);
  const state = await ReadState(client, userId, false);
  const saved = action.result || {};
  return {
    ...saved,
    ok: true,
    duplicate: true,
    stateRevision: Number(state.revision) || Number(saved.stateRevision) || 0,
    record: state.payload?.ratings?.[action.tt_id] || saved.record || null,
    queue: QueueSnapshot(queue)
  };
}

async function ReadState(client, userId, lock) {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query(`SELECT payload, revision FROM ${Qualified("user_states")} WHERE user_id=$1${suffix}`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function ReadQueue(client, userId, lock) {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query(`SELECT pool_version, seed, queue_ids, revision FROM ${Qualified("rater_queues")} WHERE user_id=$1${suffix}`, [userId]);
  return result.rows[0] || null;
}

async function ReadRecommendationIds(client, userId) {
  const result = await client.query(`SELECT tt_id FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND tt_id <> ''`, [userId]);
  return result.rows.map((row) => row.tt_id);
}

async function ReadAction(client, userId, actionId) {
  const result = await client.query(`SELECT tt_id, result FROM ${Qualified("rater_actions")} WHERE user_id=$1 AND action_id=$2`, [userId, actionId]);
  return result.rows[0] || null;
}

async function WriteStatePayload(client, userId, payload) {
  const result = await client.query(
    `UPDATE ${Qualified("user_states")} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`,
    [userId, JSON.stringify(payload)]
  );
  return Number(result.rows[0]?.revision) || 0;
}

async function WriteQueue(client, userId, queueIds, poolVersion = null) {
  const result = await client.query(
    `UPDATE ${Qualified("rater_queues")} SET queue_ids=$2::jsonb, pool_version=COALESCE($3, pool_version), revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING pool_version, seed, queue_ids, revision`,
    [userId, JSON.stringify(queueIds), poolVersion]
  );
  return result.rows[0];
}

async function InsertRecommendation(client, userId, item) {
  await client.query(
    `INSERT INTO ${Qualified("recommendation_queue")} (user_id, item_key, tt_id, title, release_year, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING`,
    [userId, item.queueKey, item.ttId, item.title, item.year || null, JSON.stringify(item)]
  );
}

async function InsertAction(client, userId, decision, result) {
  await client.query(
    `INSERT INTO ${Qualified("rater_actions")} (user_id, action_id, kind, tt_id, result, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
    [userId, decision.actionId, decision.kind, decision.ttId, JSON.stringify(result)]
  );
}

async function WithTransaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function Qualified(table) {
  const schema = ReadDatabaseSchema();
  return `"${schema}"."${table}"`;
}
