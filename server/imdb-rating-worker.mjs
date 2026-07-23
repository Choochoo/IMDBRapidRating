import { DeleteImdbRating, SubmitImdbRating } from "./imdb-ratings.mjs";

const DefaultMaximumRps = 10;
const DefaultConcurrency = 4;
const IdleDelayMs = 250;
const ErrorDelayMs = 1000;
const MaximumRetryDelayMs = 300_000;
const MinimumThrottleDelayMs = 1000;

export function CreateImdbRatingWorker(options) {
  return new ImdbRatingWorker(options);
}

class ImdbRatingWorker {
  constructor({ store, submitImdbRating = SubmitImdbRating, deleteImdbRating = DeleteImdbRating, maximumRps = ReadMaximumRps(), concurrency = ReadConcurrency(), random = Math.random }) {
    this.Store = store;
    this.SubmitImdbRating = submitImdbRating;
    this.DeleteImdbRating = deleteImdbRating;
    this.MaximumRps = maximumRps;
    this.Concurrency = concurrency;
    this.Random = random;
    this.Running = false;
    this.Loops = [];
  }

  async Start() {
    if (this.Running)
      return;
    await this.Store.ConfigureImdbDispatchRate(this.MaximumRps);
    this.Running = true;
    this.Loops = Array.from({ length: this.Concurrency }, () => this.RunLoop());
  }

  async Stop() {
    this.Running = false;
    await Promise.allSettled(this.Loops);
    this.Loops = [];
  }

  async RunLoop() {
    while (this.Running) {
      const delayMs = await this.ProcessNext().catch((error) => this.HandleWorkerError(error));
      if (this.Running)
        await Wait(Math.min(1000, delayMs));
    }
  }

  async ProcessNext() {
    const claimed = await this.Store.ClaimImdbRatingJob();
    if (!claimed.job)
      return PositiveWait(claimed.waitMs);
    const result = await this.SubmitJob(claimed.job);
    await this.HandleResult(claimed.job, result);
    return 0;
  }

  async SubmitJob(job) {
    const cookie = await this.Store.getSecret(job.userId, "imdb");
    if (!cookie)
      return MissingCookieResult();
    const operation = job.operation === "delete" ? this.DeleteImdbRating(job.ttId, cookie) : this.SubmitImdbRating(job.ttId, job.rating, cookie);
    return await operation.catch((error) => NetworkErrorResult(error));
  }

  async HandleResult(job, result) {
    if (result.payload?.ok)
      return await this.Store.CompleteImdbRatingJob(job, result);
    if (result.status === 429)
      return await this.HandleThrottle(job, result);
    if (IsAuthenticationFailure(result))
      return await this.Store.FailImdbRatingJob(job, result, { authRequired: true });
    if (IsTransientFailure(result))
      return await this.Store.RetryImdbRatingJob(job, result, this.BuildRetryDelay(job));
    return await this.Store.FailImdbRatingJob(job, result, { authRequired: false });
  }

  async HandleThrottle(job, result) {
    const delayMs = Math.max(MinimumThrottleDelayMs, Number(result.payload?.retryAfterMs) || 0, this.BuildRetryDelay(job));
    console.warn(`IMDb returned 429; lowering the global dispatch rate and waiting ${delayMs}ms.`);
    return await this.Store.ThrottleImdbRatingJob(job, result, delayMs);
  }

  BuildRetryDelay(job) {
    const exponent = Math.min(8, Math.max(1, Number(job.attemptCount) || 1));
    const baseDelay = Math.min(MaximumRetryDelayMs, 1000 * (2 ** exponent));
    return Math.round(baseDelay + (baseDelay * 0.2 * this.Random()));
  }

  HandleWorkerError(error) {
    console.error(`IMDb rating worker failed: ${error.message}`);
    return ErrorDelayMs;
  }
}

function MissingCookieResult() {
  return {
    status: 401,
    payload: { ok: false, code: "IMDB_COOKIE_MISSING", error: "IMDb sign-in is required before this queued rating can be sent." }
  };
}

function NetworkErrorResult(error) {
  return {
    status: 0,
    payload: { ok: false, code: "IMDB_NETWORK_ERROR", error: error.message || "IMDb could not be reached." }
  };
}

function IsAuthenticationFailure(result) {
  return [401, 403].includes(result.status) || /AUTH|COOKIE|SIGN.?IN/i.test(String(result.payload?.code || result.payload?.error || ""));
}

function IsTransientFailure(result) {
  return result.status === 0 || result.status >= 500;
}

function ReadMaximumRps() {
  return Math.max(0.25, Number(process.env.IMDB_MAX_REQUESTS_PER_SECOND) || DefaultMaximumRps);
}

function ReadConcurrency() {
  return Math.max(1, Math.min(20, Number(process.env.IMDB_WORKER_CONCURRENCY) || DefaultConcurrency));
}

function PositiveWait(value) {
  const waitMs = Number(value);
  return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : IdleDelayMs;
}

async function Wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
}
