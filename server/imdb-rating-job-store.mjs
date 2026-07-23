import { Qualified, RunTransaction } from "./db/transaction.mjs";
import { NormalizeMediaType, ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

const PendingStatus = "pending";
const ProcessingStatus = "processing";
const SucceededStatus = "succeeded";
const FailedStatus = "failed";
const AuthRequiredStatus = "auth_required";
const SubmittedStatus = "submitted";
const RatedStatus = "rated";
const RateOperation = "rate";
const DeleteOperation = "delete";
const DefaultImdbError = "IMDb request failed.";
const LeaseSeconds = 120;
const RecoverySuccessCount = 100;

export function CreateImdbRatingJobStore(pool) {
  return { ...BuildQueueMethods(pool), ...BuildDispatchMethods(pool), ...BuildRecoveryMethods(pool) };
}

function BuildQueueMethods(pool) {
  return {
    QueueImdbRating: async (userId, record, mediaType = record?.mediaType) => await RunTransaction(pool, async (client) => await QueueRating(client, userId, record, mediaType)),
    QueueImdbDelete: async (userId, ttId, mediaType = "movie", options = {}) => await RunTransaction(pool, async (client) => await QueueDelete(client, userId, ttId, mediaType, Boolean(options.deferAccountState))),
    ReadImdbRatingQueueStatus: async (userId) => await ReadQueueStatus(pool, userId)
  };
}

function BuildDispatchMethods(pool) {
  return {
    ConfigureImdbDispatchRate: async (maximumRps) => await ConfigureDispatchRate(pool, maximumRps),
    ClaimImdbRatingJob: async () => await RunTransaction(pool, async (client) => await ClaimNextJob(client)),
    CompleteImdbRatingJob: async (job, result) => await RunTransaction(pool, async (client) => await CompleteJob(client, job, result)),
    RetryImdbRatingJob: async (job, error, delayMs) => await RetryJob(pool, job, error, delayMs),
    ThrottleImdbRatingJob: async (job, error, delayMs) => await RunTransaction(pool, async (client) => await ThrottleJob(client, job, error, delayMs)),
    FailImdbRatingJob: async (job, error, options = {}) => await RunTransaction(pool, async (client) => await FailJob(client, job, error, Boolean(options.authRequired)))
  };
}

function BuildRecoveryMethods(pool) {
  return {
    ResumeImdbRatingJobs: async (userId) => await RunTransaction(pool, async (client) => await RequeueUserJobs(client, userId, [AuthRequiredStatus])),
    RetryFailedImdbRatingJobs: async (userId) => await RunTransaction(pool, async (client) => await RequeueUserJobs(client, userId, [FailedStatus, AuthRequiredStatus]))
  };
}

export async function UpsertImdbRatingJob(client, userId, record, mediaType = record?.mediaType) {
  const key = NormalizeMediaType(mediaType);
  const payload = { ...record, mediaType: key, submitStatus: PendingStatus, submitError: "", submittedAt: "" };
  const result = await client.query(`INSERT INTO ${Qualified("imdb_rating_jobs")} AS jobs (user_id, media_type, tt_id, operation, rating, payload) VALUES ($1, $2, $3, '${RateOperation}', $4, $5::jsonb) ON CONFLICT (user_id, media_type, tt_id) DO UPDATE SET operation='${RateOperation}', rating=EXCLUDED.rating, payload=EXCLUDED.payload, status='${PendingStatus}', generation=jobs.generation+1, attempt_count=0, available_at=now(), lease_expires_at=NULL, last_http_status=NULL, last_error='', updated_at=now(), completed_at=NULL RETURNING id, generation, status`, [userId, key, record.ttId, record.rating, JSON.stringify(payload)]);
  return result.rows[0];
}

export async function UpsertPendingImdbJobs(client, userId, payload) {
  const jobs = BuildPendingJobs(payload);
  if (!jobs.length)
    return 0;
  const sql = `INSERT INTO ${Qualified("imdb_rating_jobs")} AS jobs (user_id, media_type, tt_id, operation, rating, payload) SELECT $1, item->>'mediaType', item->>'ttId', '${RateOperation}', (item->>'rating')::smallint, item->'payload' FROM jsonb_array_elements($2::jsonb) item ON CONFLICT (user_id, media_type, tt_id) DO UPDATE SET operation='${RateOperation}', rating=EXCLUDED.rating, payload=EXCLUDED.payload, status='${PendingStatus}', generation=jobs.generation+1, attempt_count=0, available_at=now(), lease_expires_at=NULL, last_http_status=NULL, last_error='', updated_at=now(), completed_at=NULL WHERE jobs.operation<>'${RateOperation}' OR jobs.rating IS DISTINCT FROM EXCLUDED.rating OR (jobs.status IN ('${PendingStatus}', '${ProcessingStatus}') AND jobs.payload IS DISTINCT FROM EXCLUDED.payload)`;
  const result = await client.query(sql, [userId, JSON.stringify(jobs)]);
  return result.rowCount;
}

export async function ReconcileImdbUndoJob(client, userId, current, previous, mediaType) {
  if (HasRating(previous))
    return await UpsertImdbRatingJob(client, userId, previous, mediaType);
  const status = await ReadJobStatus(client, userId, current?.ttId, mediaType);
  if (!status)
    return null;
  const mightHaveReachedImdb = current?.submitStatus === SubmittedStatus || [ProcessingStatus, SucceededStatus].includes(status);
  if (mightHaveReachedImdb)
    return await UpsertImdbDeleteJob(client, userId, current.ttId, mediaType);
  await DeleteJob(client, userId, current.ttId, mediaType);
  return null;
}

async function QueueRating(client, userId, record, mediaType) {
  const key = NormalizeMediaType(mediaType);
  const pending = { ...record, mediaType: key, submitStatus: PendingStatus, submitError: "", submittedAt: "" };
  const state = await ReadUserState(client, userId);
  const job = await UpsertImdbRatingJob(client, userId, pending, key);
  const revision = await WriteRatingState(client, state.payload, userId, key, pending);
  await DeleteRecommendation(client, userId, pending.ttId, key);
  return { job, revision, record: pending };
}

async function QueueDelete(client, userId, ttId, mediaType, deferAccountState) {
  const key = NormalizeMediaType(mediaType);
  const state = deferAccountState ? null : await ReadUserState(client, userId);
  const job = await UpsertImdbDeleteJob(client, userId, ttId, key);
  const revision = deferAccountState ? undefined : await DeleteRatingState(client, state.payload, userId, key, ttId);
  return { job, revision };
}

export async function UpsertImdbDeleteJob(client, userId, ttId, mediaType) {
  const key = NormalizeMediaType(mediaType);
  const payload = JSON.stringify({ ttId, mediaType: key });
  const result = await client.query(`INSERT INTO ${Qualified("imdb_rating_jobs")} AS jobs (user_id, media_type, tt_id, operation, rating, payload) VALUES ($1, $2, $3, '${DeleteOperation}', NULL, $4::jsonb) ON CONFLICT (user_id, media_type, tt_id) DO UPDATE SET operation='${DeleteOperation}', rating=NULL, payload=EXCLUDED.payload, status='${PendingStatus}', generation=jobs.generation+1, attempt_count=0, available_at=now(), lease_expires_at=NULL, last_http_status=NULL, last_error='', updated_at=now(), completed_at=NULL RETURNING id, generation, status`, [userId, key, ttId, payload]);
  return result.rows[0];
}

async function ReadJobStatus(client, userId, ttId, mediaType) {
  const result = await client.query(`SELECT status FROM ${Qualified("imdb_rating_jobs")} WHERE user_id=$1 AND media_type=$2 AND tt_id=$3 FOR UPDATE`, [userId, NormalizeMediaType(mediaType), ttId]);
  return result.rows[0]?.status || "";
}

async function DeleteJob(client, userId, ttId, mediaType) {
  await client.query(`DELETE FROM ${Qualified("imdb_rating_jobs")} WHERE user_id=$1 AND media_type=$2 AND tt_id=$3`, [userId, NormalizeMediaType(mediaType), ttId]);
}

function HasRating(record) {
  const hasRating = Number.isInteger(record?.rating) && record.rating >= 1 && record.rating <= 10;
  const hasRatingStatus = [RatedStatus, "imported"].includes(record?.status);
  return hasRating && hasRatingStatus;
}

function BuildPendingJobs(payload) {
  return ["movie", "tv"].flatMap((mediaType) => BuildMediaPendingJobs(payload, mediaType));
}

function BuildMediaPendingJobs(payload, mediaType) {
  const ratings = ReadMediaPayload(payload, mediaType).ratings || {};
  return Object.values(ratings).filter(IsPendingRating).map((record) => ({ mediaType, ttId: record.ttId, rating: record.rating, payload: { ...record, mediaType } }));
}

function IsPendingRating(record) {
  const hasPendingStatus = record?.status === RatedStatus && record.submitStatus === PendingStatus;
  const hasTitleId = /^tt\d+$/.test(record?.ttId || "");
  const hasRating = Number.isInteger(record?.rating) && record.rating >= 1 && record.rating <= 10;
  return hasPendingStatus && hasTitleId && hasRating;
}

async function ClaimNextJob(client) {
  const dispatch = await LockDispatchState(client);
  const waitMs = MillisecondsUntil(dispatch.next_attempt_at);
  if (waitMs > 0)
    return { job: null, waitMs };
  const job = await ClaimAvailableJob(client);
  if (!job)
    return { job: null, waitMs: 250 };
  await ReserveDispatchSlot(client);
  return { job: NormalizeJob(job), waitMs: 0 };
}

async function LockDispatchState(client) {
  const result = await client.query(`SELECT maximum_rps, current_rps, next_attempt_at, success_streak FROM ${Qualified("imdb_rating_dispatch_state")} WHERE singleton=true FOR UPDATE`);
  return result.rows[0];
}

async function ClaimAvailableJob(client) {
  const sql = `WITH user_history AS (SELECT user_id, max(last_attempt_at) last_attempt_at FROM ${Qualified("imdb_rating_jobs")} GROUP BY user_id), candidates AS (SELECT DISTINCT ON (jobs.user_id) jobs.id, jobs.available_at, history.last_attempt_at user_last_attempt FROM ${Qualified("imdb_rating_jobs")} jobs LEFT JOIN user_history history ON history.user_id=jobs.user_id WHERE (jobs.status='${PendingStatus}' AND jobs.available_at<=now()) OR (jobs.status='${ProcessingStatus}' AND jobs.lease_expires_at<=now()) ORDER BY jobs.user_id, jobs.available_at, jobs.id), chosen AS (SELECT id FROM candidates ORDER BY user_last_attempt NULLS FIRST, available_at, id LIMIT 1) UPDATE ${Qualified("imdb_rating_jobs")} jobs SET status='${ProcessingStatus}', attempt_count=attempt_count+1, last_attempt_at=now(), lease_expires_at=now()+interval '${LeaseSeconds} seconds', updated_at=now() WHERE jobs.id=(SELECT id FROM chosen) RETURNING jobs.*`;
  const result = await client.query(sql);
  return result.rows[0] || null;
}

async function ReserveDispatchSlot(client) {
  await client.query(`UPDATE ${Qualified("imdb_rating_dispatch_state")} SET next_attempt_at=now()+(interval '1 second'/current_rps::double precision), updated_at=now() WHERE singleton=true`);
}

async function CompleteJob(client, job, result) {
  await LockDispatchState(client);
  const state = job.operation === RateOperation ? await ReadUserState(client, job.userId) : null;
  const completed = await MarkJobSucceeded(client, job, result.status);
  if (!completed)
    return { completed: false };
  if (job.operation === RateOperation)
    await MarkRatingSubmitted(client, job, result.payload.rating, state);
  await NoteDispatchSuccess(client);
  return { completed: true, userId: job.userId, mediaType: job.mediaType, ttId: job.ttId };
}

async function MarkJobSucceeded(client, job, httpStatus) {
  const result = await client.query(`UPDATE ${Qualified("imdb_rating_jobs")} SET status='${SucceededStatus}', lease_expires_at=NULL, last_http_status=$3, last_error='', completed_at=now(), updated_at=now() WHERE id=$1 AND generation=$2 AND status='${ProcessingStatus}' RETURNING id`, [job.id, job.generation, httpStatus]);
  return Boolean(result.rowCount);
}

async function MarkRatingSubmitted(client, job, echoRating, state) {
  const media = ReadMediaPayload(state.payload, job.mediaType);
  const current = media.ratings?.[job.ttId];
  if (!current || Number(current.rating) !== Number(job.rating))
    return;
  const submitted = BuildSubmittedRecord(current, echoRating);
  await WriteRatingState(client, state.payload, job.userId, job.mediaType, submitted);
}

function BuildSubmittedRecord(record, rating) {
  const updatedAt = NextRecordTimestamp(record);
  return { ...record, submitStatus: SubmittedStatus, submitError: "", submittedAt: updatedAt, updatedAt, imdbEchoRating: rating };
}

async function NoteDispatchSuccess(client) {
  const sql = `UPDATE ${Qualified("imdb_rating_dispatch_state")} SET current_rps=LEAST(maximum_rps, current_rps+CASE WHEN success_streak+1>=${RecoverySuccessCount} THEN 1 ELSE 0 END), success_streak=CASE WHEN success_streak+1>=${RecoverySuccessCount} THEN 0 ELSE success_streak+1 END, updated_at=now() WHERE singleton=true`;
  await client.query(sql);
}

async function RetryJob(pool, job, error, delayMs) {
  const message = String(error?.payload?.error || error?.message || DefaultImdbError);
  const status = Number(error?.status) || null;
  const result = await pool.query(`UPDATE ${Qualified("imdb_rating_jobs")} SET status='${PendingStatus}', available_at=now()+($3::double precision*interval '1 millisecond'), lease_expires_at=NULL, last_http_status=$4, last_error=$5, updated_at=now() WHERE id=$1 AND generation=$2 AND status='${ProcessingStatus}'`, [job.id, job.generation, delayMs, status, message]);
  return Boolean(result.rowCount);
}

async function ThrottleJob(client, job, error, delayMs) {
  await LockDispatchState(client);
  await client.query(`UPDATE ${Qualified("imdb_rating_dispatch_state")} SET current_rps=GREATEST(0.25, current_rps/2), next_attempt_at=GREATEST(next_attempt_at, now()+($1::double precision*interval '1 millisecond')), success_streak=0, updated_at=now() WHERE singleton=true`, [delayMs]);
  return await RetryJob(client, job, error, delayMs);
}

async function FailJob(client, job, error, authRequired) {
  const state = job.operation === RateOperation ? await ReadUserState(client, job.userId) : null;
  if (authRequired)
    return await FailAuthentication(client, job, error, state);
  const failed = await MarkJobFailed(client, job, error, FailedStatus);
  if (!failed || job.operation !== RateOperation)
    return failed;
  await MarkRatingFailed(client, job, error, state);
  return true;
}

async function FailAuthentication(client, job, error, state) {
  const failed = await PauseUserJobs(client, job.userId, error);
  if (failed && job.operation === RateOperation)
    await MarkRatingFailed(client, job, error, state);
  return failed;
}

async function PauseUserJobs(client, userId, error) {
  const message = String(error?.payload?.error || error?.message || DefaultImdbError);
  const httpStatus = Number(error?.status) || null;
  const result = await client.query(`UPDATE ${Qualified("imdb_rating_jobs")} SET status='${AuthRequiredStatus}', generation=generation+1, lease_expires_at=NULL, last_http_status=$2, last_error=$3, updated_at=now() WHERE user_id=$1 AND status IN ('${PendingStatus}', '${ProcessingStatus}')`, [userId, httpStatus, message]);
  return Boolean(result.rowCount);
}

async function MarkJobFailed(client, job, error, status) {
  const message = String(error?.payload?.error || error?.message || DefaultImdbError);
  const httpStatus = Number(error?.status) || null;
  const result = await client.query(`UPDATE ${Qualified("imdb_rating_jobs")} SET status=$3, lease_expires_at=NULL, last_http_status=$4, last_error=$5, updated_at=now() WHERE id=$1 AND generation=$2 AND status='${ProcessingStatus}' RETURNING id`, [job.id, job.generation, status, httpStatus, message]);
  return Boolean(result.rowCount);
}

async function MarkRatingFailed(client, job, error, state) {
  const media = ReadMediaPayload(state.payload, job.mediaType);
  const current = media.ratings?.[job.ttId];
  if (!current || Number(current.rating) !== Number(job.rating))
    return;
  const message = String(error?.payload?.error || error?.message || DefaultImdbError);
  const failed = { ...current, submitStatus: FailedStatus, submitError: message, submittedAt: "", updatedAt: NextRecordTimestamp(current) };
  await WriteRatingState(client, state.payload, job.userId, job.mediaType, failed);
}

async function WriteRatingState(client, payload, userId, mediaType, record) {
  const media = ReadMediaPayload(payload, mediaType);
  const ratings = { ...(media.ratings || {}), [record.ttId]: record };
  const nextPayload = WriteMediaPayload(payload, mediaType, { ...media, ratings });
  const result = await client.query(`UPDATE ${Qualified("user_states")} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`, [userId, JSON.stringify(nextPayload)]);
  return Number(result.rows[0]?.revision) || 0;
}

async function DeleteRatingState(client, payload, userId, mediaType, ttId) {
  const media = ReadMediaPayload(payload, mediaType);
  const ratings = { ...(media.ratings || {}) };
  delete ratings[ttId];
  const nextPayload = WriteMediaPayload(payload, mediaType, { ...media, ratings });
  return await WriteUserPayload(client, userId, nextPayload);
}

async function ReadUserState(client, userId) {
  const result = await client.query(`SELECT payload, revision FROM ${Qualified("user_states")} WHERE user_id=$1 FOR UPDATE`, [userId]);
  return result.rows[0] || { payload: {}, revision: 0 };
}

async function DeleteRecommendation(client, userId, ttId, mediaType) {
  await client.query(`DELETE FROM ${Qualified("recommendation_queue")} WHERE user_id=$1 AND media_type=$2 AND tt_id=$3`, [userId, mediaType, ttId]);
}

async function ConfigureDispatchRate(pool, maximumRps) {
  const rate = Math.max(0.25, Number(maximumRps) || 10);
  const result = await pool.query(`UPDATE ${Qualified("imdb_rating_dispatch_state")} SET maximum_rps=$1, current_rps=LEAST(current_rps, $1), updated_at=now() WHERE singleton=true RETURNING maximum_rps, current_rps`, [rate]);
  return { maximumRps: Number(result.rows[0].maximum_rps), currentRps: Number(result.rows[0].current_rps) };
}

async function ReadQueueStatus(pool, userId) {
  const jobs = await pool.query(`SELECT status, count(*)::integer count FROM ${Qualified("imdb_rating_jobs")} WHERE user_id=$1 GROUP BY status`, [userId]);
  const dispatch = await pool.query(`SELECT maximum_rps, current_rps, next_attempt_at FROM ${Qualified("imdb_rating_dispatch_state")} WHERE singleton=true`);
  return BuildQueueStatus(jobs.rows, dispatch.rows[0]);
}

async function RequeueUserJobs(client, userId, statuses) {
  const state = await ReadUserState(client, userId);
  const result = await client.query(`UPDATE ${Qualified("imdb_rating_jobs")} SET status='${PendingStatus}', generation=generation+1, available_at=now(), lease_expires_at=NULL, last_http_status=NULL, last_error='', completed_at=NULL, updated_at=now() WHERE user_id=$1 AND status=ANY($2::varchar[]) RETURNING media_type, tt_id, rating, operation`, [userId, statuses]);
  const payload = MarkRequeuedRatings(state.payload, result.rows);
  const revision = payload === state.payload ? Number(state.revision) || 0 : await WriteUserPayload(client, userId, payload);
  return { queued: result.rowCount, revision };
}

function MarkRequeuedRatings(payload, jobs) {
  return jobs.reduce((current, job) => MarkRequeuedRating(current, job), payload);
}

function MarkRequeuedRating(payload, job) {
  const media = ReadMediaPayload(payload, job.media_type);
  const current = media.ratings?.[job.tt_id];
  if (job.operation !== RateOperation || !current || Number(current.rating) !== Number(job.rating))
    return payload;
  const pending = { ...current, submitStatus: PendingStatus, submitError: "", submittedAt: "", updatedAt: NextRecordTimestamp(current) };
  return WriteMediaPayload(payload, job.media_type, { ...media, ratings: { ...(media.ratings || {}), [job.tt_id]: pending } });
}

function NextRecordTimestamp(record) {
  const ratedAt = Date.parse(record?.at || "") || 0;
  const submittedAt = Date.parse(record?.submittedAt || "") || 0;
  const updatedAt = Date.parse(record?.updatedAt || "") || 0;
  const previous = Math.max(ratedAt, submittedAt, updatedAt);
  return new Date(Math.max(Date.now(), previous + 1)).toISOString();
}

async function WriteUserPayload(client, userId, payload) {
  const result = await client.query(`UPDATE ${Qualified("user_states")} SET payload=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision`, [userId, JSON.stringify(payload)]);
  return Number(result.rows[0]?.revision) || 0;
}

function BuildQueueStatus(rows, dispatch) {
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  return {
    counts,
    maximumRps: Number(dispatch.maximum_rps),
    currentRps: Number(dispatch.current_rps),
    nextAttemptAt: dispatch.next_attempt_at
  };
}

function NormalizeJob(row) {
  return {
    id: Number(row.id),
    userId: row.user_id,
    mediaType: row.media_type,
    ttId: row.tt_id,
    operation: row.operation,
    rating: row.rating === null ? null : Number(row.rating),
    payload: row.payload || {},
    generation: Number(row.generation),
    attemptCount: Number(row.attempt_count)
  };
}

function MillisecondsUntil(value) {
  return Math.max(0, new Date(value).getTime() - Date.now());
}
