import { CreateQueueSeed, QueueSnapshot, ReconcileQueueIds, SameQueueIds } from "./rater-queue.mjs";
import { Qualified, RunTransaction } from "./db/transaction.mjs";
import { NormalizeMediaType, ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";
import { FilterTitlePool } from "./movie-pool.mjs";
import { ReconcileImdbUndoJob, UpsertImdbRatingJob } from "./imdb-rating-job-store.mjs";

const QueueConflictCode = "QUEUE_CONFLICT";
const ForUpdateClause = " FOR UPDATE";
const RaterQueuesTable = "rater_queues";
const RaterActionsTable = "rater_actions";
const RecommendationQueueTable = "recommendation_queue";
const UserStatesTable = "user_states";

export function CreateRaterQueueStore(pool) {
  return {
    getRaterQueue: async (userId, mediaTypeOrPool, maybePool) => await GetRaterQueue(pool, userId, mediaTypeOrPool, maybePool),
    commitRaterDecision: async (userId, decision) => await CommitRaterDecision(pool, userId, decision),
    CommitQuickRating: async (userId, decision) => await RunQuickRating(pool, userId, decision),
    commitRaterUndo: async (userId, request) => await CommitRaterUndo(pool, userId, request),
    replaceRaterQueue: async (userId, request, mediaTypeOrPool, maybePool) => await ReplaceRaterQueue(pool, userId, request, mediaTypeOrPool, maybePool)
  };
}

async function GetRaterQueue(pool, userId, mediaTypeOrPool, maybePool) {
  const { mediaType, titlePool } = ReadPoolArguments(mediaTypeOrPool, maybePool);
  return await RunTransaction(pool, async (client) => await ReconcileStoredQueue(client, userId, mediaType, titlePool));
}

async function ReconcileStoredQueue(client, userId, mediaType, titlePool) {
  let queue = await ReadQueue(client, userId, mediaType, true);
  const state = await ReadState(client, userId, true);
  const recommendations = await ReadRecommendationIds(client, userId, mediaType);
  if (!queue)
    queue = await ReadQueue(client, userId, mediaType, true);
  const candidate = BuildQueueCandidate(queue, state, recommendations, mediaType, titlePool);
  const stored = await SaveReconciledQueue(client, userId, mediaType, queue, candidate);
  return { ...QueueSnapshot(stored), changed: candidate.changed };
}

function BuildQueueCandidate(queue, state, recommendations, mediaType, titlePool) {
  const seed = String(queue?.seed || CreateQueueSeed());
  const media = ReadMediaPayload(state.payload, mediaType);
  const eligiblePool = FilterTitlePool(titlePool, media.filters);
  const legacyIds = queue ? queue.queue_ids : media.queueIds;
  const unavailable = [...Object.keys(media.ratings || {}), ...recommendations];
  const queueIds = ReconcileQueueIds(legacyIds, eligiblePool.ids, unavailable, seed);
  const changed = !queue || queue.pool_version !== eligiblePool.version || !SameQueueIds(queue.queue_ids, queueIds);
  return { seed, eligiblePool, queueIds, changed };
}

async function SaveReconciledQueue(client, userId, mediaType, queue, candidate) {
  if (!queue)
    return await InsertRaterQueue(client, userId, mediaType, candidate);
  if (candidate.changed)
    return await UpdateRaterQueue(client, userId, mediaType, candidate);
  return queue;
}

async function InsertRaterQueue(client, userId, mediaType, candidate) {
  const statement = `INSERT INTO ${Qualified(RaterQueuesTable)} (user_id, media_type, pool_version, seed, queue_ids, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, 1, now(), now()) RETURNING pool_version, seed, queue_ids, revision`;
  const parameters = [userId, mediaType, candidate.eligiblePool.version, candidate.seed, JSON.stringify(candidate.queueIds)];
  return (await client.query(statement, parameters)).rows[0];
}

async function UpdateRaterQueue(client, userId, mediaType, candidate) {
  const statement = `UPDATE ${Qualified(RaterQueuesTable)} SET pool_version=$3, queue_ids=$4::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 AND media_type=$2 RETURNING pool_version, seed, queue_ids, revision`;
  const parameters = [userId, mediaType, candidate.eligiblePool.version, JSON.stringify(candidate.queueIds)];
  return (await client.query(statement, parameters)).rows[0];
}

async function CommitRaterDecision(pool, userId, decision) {
  const mediaType = NormalizeMediaType(decision.mediaType);
  return await RunTransaction(pool, async (client) => await CommitRaterDecisionTransaction(client, userId, mediaType, decision));
}

async function CommitRaterDecisionTransaction(client, userId, mediaType, decision) {
  const context = await ReadDecisionContext(client, userId, mediaType, decision);
  if (context.result)
    return context.result;
  if (!context.queue)
    return { ok: false, code: "QUEUE_NOT_READY", current: QueueSnapshot(null) };
  if (context.current.revision !== decision.expectedRevision || context.current.queueIds[0] !== decision.ttId)
    return { ok: false, code: QueueConflictCode, current: context.current };
  return await WriteRaterDecision(client, userId, mediaType, decision, context);
}

async function ReadDecisionContext(client, userId, mediaType, decision) {
  const duplicate = await ReadAction(client, userId, mediaType, decision.actionId);
  if (duplicate)
    return { result: await BuildDuplicateResult(client, userId, mediaType, duplicate) };
  const queue = await ReadQueue(client, userId, mediaType, true);
  const committedDuplicate = await ReadAction(client, userId, mediaType, decision.actionId);
  if (committedDuplicate)
    return { result: await BuildDuplicateResult(client, userId, mediaType, committedDuplicate) };
  return { queue, current: QueueSnapshot(queue), result: null };
}

async function WriteRaterDecision(client, userId, mediaType, decision, context) {
  const saved = await SaveRaterDecision(client, userId, mediaType, decision, context.current);
  const result = BuildRaterDecisionResult(decision, saved);
  await InsertAction(client, userId, mediaType, decision, result);
  return result;
}

async function SaveRaterDecision(client, userId, mediaType, decision, current) {
  const state = await ReadState(client, userId, true);
  const media = ReadMediaPayload(state.payload, mediaType);
  const previous = media.ratings?.[decision.ttId] || null;
  const nextPayload = ApplyDecisionToPayload(state.payload, mediaType, decision, previous);
  const stateRevision = decision.record ? await WriteStatePayload(client, userId, nextPayload) : Number(state.revision) || 0;
  await WriteDecisionTarget(client, userId, mediaType, decision);
  const nextQueue = await WriteQueue(client, userId, mediaType, current.queueIds.slice(1));
  return { previous, stateRevision, nextQueue };
}

async function WriteDecisionTarget(client, userId, mediaType, decision) {
  if (decision.kind === "rated")
    await UpsertImdbRatingJob(client, userId, decision.record, mediaType);
  if (decision.recommendation)
    await InsertRecommendation(client, userId, mediaType, decision.recommendation);
}

function BuildRaterDecisionResult(decision, saved) {
  return {
    ok: true,
    duplicate: false,
    stateRevision: saved.stateRevision,
    record: decision.record || null,
    previous: saved.previous,
    recommendation: decision.recommendation || null,
    queue: QueueSnapshot(saved.nextQueue)
  };
}

async function RunQuickRating(pool, userId, decision) {
  const mediaType = NormalizeMediaType(decision.mediaType);
  return await RunTransaction(pool, async (client) => await CommitQuickRating(client, userId, mediaType, decision));
}

async function CommitRaterUndo(pool, userId, request) {
  const mediaType = NormalizeMediaType(request.mediaType);
  return await RunTransaction(pool, async (client) => await CommitRaterUndoTransaction(client, userId, mediaType, request));
}

async function CommitRaterUndoTransaction(client, userId, mediaType, request) {
  const context = await ReadUndoContext(client, userId, mediaType, request);
  if (context.result)
    return context.result;
  if (!context.queue || context.current.revision !== request.expectedRevision || context.last?.ttId !== request.ttId)
    return { ok: false, code: QueueConflictCode, current: context.current };
  return await WriteRaterUndo(client, userId, mediaType, request, context);
}

async function ReadUndoContext(client, userId, mediaType, request) {
  const duplicate = await ReadAction(client, userId, mediaType, request.actionId);
  if (duplicate)
    return { result: await BuildDuplicateResult(client, userId, mediaType, duplicate) };
  const queue = await ReadQueue(client, userId, mediaType, true);
  const committedDuplicate = await ReadAction(client, userId, mediaType, request.actionId);
  if (committedDuplicate)
    return { result: await BuildDuplicateResult(client, userId, mediaType, committedDuplicate) };
  const current = QueueSnapshot(queue);
  const state = await ReadState(client, userId, true);
  const media = ReadMediaPayload(state.payload, mediaType);
  const history = Array.isArray(media.history) ? media.history.slice(-200) : [];
  return { queue, current, state, media, history, last: history.at(-1), result: null };
}

async function WriteRaterUndo(client, userId, mediaType, request, context) {
  const mediaPayload = BuildUndoMediaPayload(context.media, context.history, context.last, request.ttId);
  await ReconcileImdbUndoJob(client, userId, context.media.ratings?.[request.ttId], context.last.previous, mediaType);
  const stateRevision = await WriteStatePayload(client, userId, WriteMediaPayload(context.state.payload, mediaType, mediaPayload));
  const queueIds = BuildUndoQueueIds(context.current.queueIds, request.ttId, context.last.previous);
  const nextQueue = await WriteQueue(client, userId, mediaType, queueIds);
  const result = BuildUndoResult(context.media, request.ttId, context.last, stateRevision, nextQueue);
  await InsertAction(client, userId, mediaType, { ...request, kind: "undo" }, result);
  return result;
}

function BuildUndoMediaPayload(media, history, last, ttId) {
  const mediaPayload = { ...media, ratings: { ...(media.ratings || {}) }, history: history.slice(0, -1) };
  if (last.previous)
    mediaPayload.ratings[ttId] = last.previous;
  else
    delete mediaPayload.ratings[ttId];
  return mediaPayload;
}

function BuildUndoQueueIds(queueIds, ttId, previous) {
  if (previous)
    return queueIds;
  return [ttId, ...queueIds.filter((queueId) => queueId !== ttId)];
}

function BuildUndoResult(media, ttId, last, stateRevision, nextQueue) {
  return {
    ok: true,
    duplicate: false,
    stateRevision,
    record: last.previous || null,
    previous: media.ratings?.[ttId] || null,
    queue: QueueSnapshot(nextQueue)
  };
}

async function ReplaceRaterQueue(pool, userId, request, mediaTypeOrPool, maybePool) {
  const { mediaType, titlePool } = ReadPoolArguments(mediaTypeOrPool, maybePool);
  return await RunTransaction(pool, async (client) => await ReplaceRaterQueueTransaction(client, userId, request, mediaType, titlePool));
}

async function ReplaceRaterQueueTransaction(client, userId, request, mediaType, titlePool) {
  const queue = await ReadQueue(client, userId, mediaType, true);
  const current = QueueSnapshot(queue);
  if (!queue || current.revision !== request.expectedRevision)
    return { ok: false, code: QueueConflictCode, current };
  const state = await ReadState(client, userId, true);
  const recommendations = await ReadRecommendationIds(client, userId, mediaType);
  const media = ReadMediaPayload(state.payload, mediaType);
  const eligiblePool = FilterTitlePool(titlePool, media.filters);
  const unavailable = [...Object.keys(media.ratings || {}), ...recommendations];
  const queueIds = ReconcileQueueIds(request.queueIds, eligiblePool.ids, unavailable, queue.seed);
  const nextQueue = await WriteQueue(client, userId, mediaType, queueIds, eligiblePool.version);
  return { ok: true, queue: QueueSnapshot(nextQueue) };
}

async function CommitQuickRating(client, userId, mediaType, decision) {
  const duplicate = await ReadAction(client, userId, mediaType, decision.actionId);
  if (duplicate)
    return await BuildDuplicateResult(client, userId, mediaType, duplicate);
  const context = await ReadQuickRatingContext(client, userId, mediaType, decision.ttId);
  const committedDuplicate = await ReadAction(client, userId, mediaType, decision.actionId);
  if (committedDuplicate)
    return await BuildDuplicateResult(client, userId, mediaType, committedDuplicate);
  const result = await WriteQuickRating(client, userId, mediaType, decision, context);
  await InsertAction(client, userId, mediaType, decision, result);
  return result;
}

async function ReadQuickRatingContext(client, userId, mediaType, ttId) {
  const queue = await ReadQueue(client, userId, mediaType, true);
  const state = await ReadState(client, userId, true);
  const media = ReadMediaPayload(state.payload, mediaType);
  return { queue, state, previous: media.ratings?.[ttId] || null };
}

async function WriteQuickRating(client, userId, mediaType, decision, context) {
  const nextPayload = ApplyDecisionToPayload(context.state.payload, mediaType, decision, context.previous);
  const stateRevision = await WriteStatePayload(client, userId, nextPayload);
  await UpsertImdbRatingJob(client, userId, decision.record, mediaType);
  await DeleteQuickRatingRecommendation(client, userId, mediaType, decision.ttId);
  const queue = await RemoveQuickRatingFromQueue(client, userId, mediaType, context.queue, decision.ttId);
  return { ok: true, duplicate: false, stateRevision, record: decision.record, previous: context.previous, queue };
}

async function DeleteQuickRatingRecommendation(client, userId, mediaType, ttId) {
  await client.query(`DELETE FROM ${Qualified(RecommendationQueueTable)} WHERE user_id=$1 AND media_type=$2 AND tt_id=$3`, [userId, mediaType, ttId]);
}

async function RemoveQuickRatingFromQueue(client, userId, mediaType, queue, ttId) {
  const current = QueueSnapshot(queue);
  const queueIds = current.queueIds.filter((queueId) => queueId !== ttId);
  if (!queue)
    return current;
  const updated = await WriteQueue(client, userId, mediaType, queueIds);
  return QueueSnapshot(updated);
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
  const suffix = lock ? ForUpdateClause : "";
  const result = await client.query(`SELECT payload, revision FROM ${Qualified(UserStatesTable)} WHERE user_id=$1${suffix}`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function ReadQueue(client, userId, mediaType, lock) {
  const suffix = lock ? ForUpdateClause : "";
  const result = await client.query(`SELECT pool_version, seed, queue_ids, revision FROM ${Qualified(RaterQueuesTable)} WHERE user_id=$1 AND media_type=$2${suffix}`, [userId, mediaType]);
  return result.rows[0] || null;
}

async function ReadRecommendationIds(client, userId, mediaType) {
  const result = await client.query(`SELECT tt_id FROM ${Qualified(RecommendationQueueTable)} WHERE user_id=$1 AND media_type=$2 AND tt_id <> ''`, [userId, mediaType]);
  return result.rows.map((row) => row.tt_id);
}

async function ReadAction(client, userId, mediaType, actionId) {
  const result = await client.query(`SELECT tt_id, result FROM ${Qualified(RaterActionsTable)} WHERE user_id=$1 AND media_type=$2 AND action_id=$3`, [userId, mediaType, actionId]);
  return result.rows[0] || null;
}

async function WriteStatePayload(client, userId, payload) {
  const statement = `UPDATE ${Qualified(UserStatesTable)} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`;
  const result = await client.query(statement, [userId, JSON.stringify(payload)]);
  return Number(result.rows[0]?.revision) || 0;
}

async function WriteQueue(client, userId, mediaType, queueIds, poolVersion = null) {
  const statement = `UPDATE ${Qualified(RaterQueuesTable)} SET queue_ids=$3::jsonb, pool_version=COALESCE($4, pool_version), revision=revision+1, updated_at=now() WHERE user_id=$1 AND media_type=$2 RETURNING pool_version, seed, queue_ids, revision`;
  const result = await client.query(statement, [userId, mediaType, JSON.stringify(queueIds), poolVersion]);
  return result.rows[0];
}

async function InsertRecommendation(client, userId, mediaType, item) {
  const statement = `INSERT INTO ${Qualified(RecommendationQueueTable)} (user_id, media_type, item_key, tt_id, title, release_year, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING`;
  const parameters = [userId, mediaType, item.queueKey, item.ttId, item.title, item.year || null, JSON.stringify({ ...item, mediaType })];
  await client.query(statement, parameters);
}

async function InsertAction(client, userId, mediaType, decision, result) {
  const statement = `INSERT INTO ${Qualified(RaterActionsTable)} (user_id, action_id, media_type, kind, tt_id, result, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`;
  const parameters = [userId, decision.actionId, mediaType, decision.kind, decision.ttId, JSON.stringify(result)];
  await client.query(statement, parameters);
}

function ReadPoolArguments(mediaTypeOrPool, maybePool) {
  if (mediaTypeOrPool && typeof mediaTypeOrPool === "object")
    return { mediaType: "movie", titlePool: mediaTypeOrPool };
  return { mediaType: NormalizeMediaType(mediaTypeOrPool), titlePool: maybePool };
}
