import { CreateQueueSeed, QueueSnapshot, ReconcileQueueIds, SameQueueIds } from "./rater-queue.mjs";
import { ReadDatabaseSchema } from "./db/config.mjs";
import { NormalizeMediaType, ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

export function CreateRaterQueueStore(pool) {
  return {
    async getRaterQueue(userId, mediaTypeOrPool, maybePool) {
      const { mediaType, titlePool } = ReadPoolArguments(mediaTypeOrPool, maybePool);
      return await WithTransaction(pool, async (client) => {
        let queue = await ReadQueue(client, userId, mediaType, true);
        const state = await ReadState(client, userId, true);
        const recommendations = await ReadRecommendationIds(client, userId, mediaType);
        if (!queue)
          queue = await ReadQueue(client, userId, mediaType, true);
        const seed = String(queue?.seed || CreateQueueSeed());
        const media = ReadMediaPayload(state.payload, mediaType);
        const legacyIds = queue ? queue.queue_ids : media.queueIds;
        const unavailable = [...Object.keys(media.ratings || {}), ...recommendations];
        const queueIds = ReconcileQueueIds(legacyIds, titlePool.ids, unavailable, seed);
        const changed = !queue || queue.pool_version !== titlePool.version || !SameQueueIds(queue.queue_ids, queueIds);
        if (!queue) {
          queue = (await client.query(
            `INSERT INTO ${Qualified("rater_queues")} (user_id, media_type, pool_version, seed, queue_ids, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, 1, now(), now()) RETURNING pool_version, seed, queue_ids, revision`,
            [userId, mediaType, titlePool.version, seed, JSON.stringify(queueIds)]
          )).rows[0];
        } else if (changed) {
          queue = (await client.query(
            `UPDATE ${Qualified("rater_queues")} SET pool_version=$3, queue_ids=$4::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 AND media_type=$2 RETURNING pool_version, seed, queue_ids, revision`,
            [userId, mediaType, titlePool.version, JSON.stringify(queueIds)]
          )).rows[0];
        }
        return { ...QueueSnapshot(queue), changed };
      });
    },

    async commitRaterDecision(userId, decision) {
      const mediaType = NormalizeMediaType(decision.mediaType);
      return await WithTransaction(pool, async (client) => {
        const duplicate = await ReadAction(client, userId, mediaType, decision.actionId);
        if (duplicate)
          return await BuildDuplicateResult(client, userId, mediaType, duplicate);
        const queue = await ReadQueue(client, userId, mediaType, true);
        const committedDuplicate = await ReadAction(client, userId, mediaType, decision.actionId);
        if (committedDuplicate)
          return await BuildDuplicateResult(client, userId, mediaType, committedDuplicate);
        if (!queue)
          return { ok: false, code: "QUEUE_NOT_READY", current: QueueSnapshot(null) };
        const current = QueueSnapshot(queue);
        if (current.revision !== decision.expectedRevision || current.queueIds[0] !== decision.ttId)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const state = await ReadState(client, userId, true);
        const media = ReadMediaPayload(state.payload, mediaType);
        const previous = media.ratings?.[decision.ttId] || null;
        const nextPayload = ApplyDecisionToPayload(state.payload, mediaType, decision, previous);
        const stateRevision = decision.record
          ? await WriteStatePayload(client, userId, nextPayload)
          : Number(state.revision) || 0;
        if (decision.recommendation)
          await InsertRecommendation(client, userId, mediaType, decision.recommendation);
        const nextQueue = await WriteQueue(client, userId, mediaType, current.queueIds.slice(1));
        const result = {
          ok: true,
          duplicate: false,
          stateRevision,
          record: decision.record || null,
          previous,
          recommendation: decision.recommendation || null,
          queue: QueueSnapshot(nextQueue)
        };
        await InsertAction(client, userId, mediaType, decision, result);
        return result;
      });
    },

    async commitRaterUndo(userId, request) {
      const mediaType = NormalizeMediaType(request.mediaType);
      return await WithTransaction(pool, async (client) => {
        const duplicate = await ReadAction(client, userId, mediaType, request.actionId);
        if (duplicate)
          return await BuildDuplicateResult(client, userId, mediaType, duplicate);
        const queue = await ReadQueue(client, userId, mediaType, true);
        const committedDuplicate = await ReadAction(client, userId, mediaType, request.actionId);
        if (committedDuplicate)
          return await BuildDuplicateResult(client, userId, mediaType, committedDuplicate);
        const current = QueueSnapshot(queue);
        const state = await ReadState(client, userId, true);
        const media = ReadMediaPayload(state.payload, mediaType);
        const history = Array.isArray(media.history) ? media.history.slice(-200) : [];
        const last = history.at(-1);
        if (!queue || current.revision !== request.expectedRevision || last?.ttId !== request.ttId)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const mediaPayload = { ...media, ratings: { ...(media.ratings || {}) }, history: history.slice(0, -1) };
        if (last.previous)
          mediaPayload.ratings[request.ttId] = last.previous;
        else
          delete mediaPayload.ratings[request.ttId];
        const stateRevision = await WriteStatePayload(client, userId, WriteMediaPayload(state.payload, mediaType, mediaPayload));
        const queueIds = last.previous
          ? current.queueIds
          : [request.ttId, ...current.queueIds.filter((ttId) => ttId !== request.ttId)];
        const nextQueue = await WriteQueue(client, userId, mediaType, queueIds);
        const result = {
          ok: true,
          duplicate: false,
          stateRevision,
          record: last.previous || null,
          previous: media.ratings?.[request.ttId] || null,
          queue: QueueSnapshot(nextQueue)
        };
        await InsertAction(client, userId, mediaType, { ...request, kind: "undo" }, result);
        return result;
      });
    },

    async replaceRaterQueue(userId, request, mediaTypeOrPool, maybePool) {
      const { mediaType, titlePool } = ReadPoolArguments(mediaTypeOrPool, maybePool);
      return await WithTransaction(pool, async (client) => {
        const queue = await ReadQueue(client, userId, mediaType, true);
        const current = QueueSnapshot(queue);
        if (!queue || current.revision !== request.expectedRevision)
          return { ok: false, code: "QUEUE_CONFLICT", current };
        const state = await ReadState(client, userId, true);
        const recommendations = await ReadRecommendationIds(client, userId, mediaType);
        const media = ReadMediaPayload(state.payload, mediaType);
        const unavailable = [...Object.keys(media.ratings || {}), ...recommendations];
        const queueIds = ReconcileQueueIds(request.queueIds, titlePool.ids, unavailable, queue.seed);
        const nextQueue = await WriteQueue(client, userId, mediaType, queueIds, titlePool.version);
        return { ok: true, queue: QueueSnapshot(nextQueue) };
      });
    }
  };
}

function ApplyDecisionToPayload(value, mediaType, decision, previous) {
  const media = ReadMediaPayload(value, mediaType);
  const mediaPayload = { ...media, ratings: { ...(media.ratings || {}) } };
  mediaPayload.ratings[decision.ttId] = { ...decision.record, mediaType };
  const history = Array.isArray(media.history) ? media.history.slice(-199) : [];
  mediaPayload.history = [...history, { ttId: decision.ttId, previous }];
  return WriteMediaPayload(value, mediaType, mediaPayload);
}

async function BuildDuplicateResult(client, userId, mediaType, action) {
  const queue = await ReadQueue(client, userId, mediaType, false);
  const state = await ReadState(client, userId, false);
  const media = ReadMediaPayload(state.payload, mediaType);
  const saved = action.result || {};
  return {
    ...saved,
    ok: true,
    duplicate: true,
    stateRevision: Number(state.revision) || Number(saved.stateRevision) || 0,
    record: media.ratings?.[action.tt_id] || saved.record || null,
    queue: QueueSnapshot(queue)
  };
}

async function ReadState(client, userId, lock) {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query(`SELECT payload, revision FROM ${Qualified("user_states")} WHERE user_id=$1${suffix}`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function ReadQueue(client, userId, mediaType, lock) {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query(`SELECT pool_version, seed, queue_ids, revision FROM ${Qualified("rater_queues")} WHERE user_id=$1 AND media_type=$2${suffix}`, [userId, mediaType]);
  return result.rows[0] || null;
}

async function ReadRecommendationIds(client, userId, mediaType) {
  const result = await client.query(`SELECT tt_id FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND media_type=$2 AND tt_id <> ''`, [userId, mediaType]);
  return result.rows.map((row) => row.tt_id);
}

async function ReadAction(client, userId, mediaType, actionId) {
  const result = await client.query(`SELECT tt_id, result FROM ${Qualified("rater_actions")} WHERE user_id=$1 AND media_type=$2 AND action_id=$3`, [userId, mediaType, actionId]);
  return result.rows[0] || null;
}

async function WriteStatePayload(client, userId, payload) {
  const result = await client.query(
    `UPDATE ${Qualified("user_states")} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`,
    [userId, JSON.stringify(payload)]
  );
  return Number(result.rows[0]?.revision) || 0;
}

async function WriteQueue(client, userId, mediaType, queueIds, poolVersion = null) {
  const result = await client.query(
    `UPDATE ${Qualified("rater_queues")} SET queue_ids=$3::jsonb, pool_version=COALESCE($4, pool_version), revision=revision+1, updated_at=now() WHERE user_id=$1 AND media_type=$2 RETURNING pool_version, seed, queue_ids, revision`,
    [userId, mediaType, JSON.stringify(queueIds), poolVersion]
  );
  return result.rows[0];
}

async function InsertRecommendation(client, userId, mediaType, item) {
  await client.query(
    `INSERT INTO ${Qualified("recommendation_queue")} (user_id, media_type, item_key, tt_id, title, release_year, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING`,
    [userId, mediaType, item.queueKey, item.ttId, item.title, item.year || null, JSON.stringify({ ...item, mediaType })]
  );
}

async function InsertAction(client, userId, mediaType, decision, result) {
  await client.query(
    `INSERT INTO ${Qualified("rater_actions")} (user_id, action_id, media_type, kind, tt_id, result, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
    [userId, decision.actionId, mediaType, decision.kind, decision.ttId, JSON.stringify(result)]
  );
}

function ReadPoolArguments(mediaTypeOrPool, maybePool) {
  if (mediaTypeOrPool && typeof mediaTypeOrPool === "object")
    return { mediaType: "movie", titlePool: mediaTypeOrPool };
  return { mediaType: NormalizeMediaType(mediaTypeOrPool), titlePool: maybePool };
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
