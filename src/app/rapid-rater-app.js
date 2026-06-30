import { Config } from "./config.js";
import { CleanText, EscapeHtml, FormatCount, NormalizeGenres, Shuffle, ToNumber } from "./util.js";
import { ParseCsv, ToCsvRow } from "../../shared/csv.js";

export class RapidRaterApp {
  constructor() {
    this.Elements = this.BuildElements();
    this.State = this.BuildState();
    this.ToastTimer = 0;
    this.SubmitInFlight = false;
    this.SubmitQueue = [];
    this.SubmitQueuedIds = new Set();
    this.MetadataInFlight = new Set();
    document.documentElement.style.setProperty("--anim", `${Config.animationMs}ms`);
  }

  Start() {
    this.BindEvents();
    this.Initialize().catch((error) => this.ShowStartupError(error));
  }

  async Initialize() {
    await this.RefreshLiveStatus();
    const data = await this.LoadMovieData();
    this.ApplyMovieData(data, data.sourceLabel);
    await this.LoadSavedRatingsCsv();
    this.PromptForMissingCookie();
  }

  BuildElements() {
    return {
      strip: this.Element("movie-strip"),
      ...this.BuildCounterElements(),
      ...this.BuildStatusElements(),
      ...this.BuildEmptyElements(),
      ...this.BuildFileElements(),
      ...this.BuildCookieElements()
    };
  }

  BuildCounterElements() {
    return {
      rated: this.Element("rated-count"),
      skipped: this.Element("skip-count"),
      imported: this.Element("imported-count"),
      sent: this.Element("sent-count"),
      failed: this.Element("failed-count"),
      left: this.Element("left-count")
    };
  }

  BuildStatusElements() {
    return {
      sourceBadge: this.Element("source-badge"),
      liveBadge: this.Element("live-badge"),
      retryFailed: this.Element("retry-failed"),
      failurePanel: this.Element("failure-panel"),
      failureList: this.Element("failure-list"),
      toast: this.Element("toast")
    };
  }

  BuildEmptyElements() {
    return {
      empty: this.Element("empty-state"),
      emptySummary: this.Element("empty-summary")
    };
  }

  BuildFileElements() {
    return {
      jsonFile: this.Element("json-file"),
      csvFile: this.Element("csv-file")
    };
  }

  BuildCookieElements() {
    return {
      configureCookie: this.Element("configure-cookie"),
      cookieDialog: this.Element("cookie-dialog"),
      cookieInput: this.Element("imdb-cookie-input"),
      cookieError: this.Element("cookie-error"),
      cookieSave: this.Element("cookie-save"),
      cookieClose: this.Element("cookie-close"),
      cookieLater: this.Element("cookie-later")
    };
  }

  BuildState() {
    return {
      movies: [],
      movieById: new Map(),
      queue: [],
      ratings: {},
      history: [],
      sourceLabel: "",
      signature: "",
      metadata: {},
      live: this.BuildLiveState(),
      locked: false,
      savedQueueIds: null
    };
  }

  BuildLiveState() {
    return {
      checked: false,
      configured: false,
      dryRun: false,
      submitting: false,
      lastError: ""
    };
  }

  Element(id) {
    return document.getElementById(id);
  }

  BindEvents() {
    this.BindToolbarEvents();
    this.BindCookieEvents();
    this.BindFileEvents();
    window.addEventListener("keydown", (event) => this.HandleKeyDown(event));
  }

  BindToolbarEvents() {
    this.Element("load-json").addEventListener("click", () => this.Elements.jsonFile.click());
    this.Element("import-csv").addEventListener("click", () => this.Elements.csvFile.click());
    this.Element("export-csv").addEventListener("click", () => this.ExportCsv());
    this.Element("export-json").addEventListener("click", () => this.ExportJson());
    this.Element("reset").addEventListener("click", () => this.ResetAll());
    this.Element("empty-reset").addEventListener("click", () => this.ResetAll());
    this.Element("empty-export-csv").addEventListener("click", () => this.ExportCsv());
    this.Element("empty-export-json").addEventListener("click", () => this.ExportJson());
    this.Elements.retryFailed.addEventListener("click", () => this.RetryUnsent());
  }

  BindCookieEvents() {
    this.Elements.configureCookie.addEventListener("click", () => this.ShowCookieDialog());
    this.Elements.cookieClose.addEventListener("click", () => this.HideCookieDialog());
    this.Elements.cookieLater.addEventListener("click", () => this.HideCookieDialog());
    this.Elements.cookieSave.addEventListener("click", () => this.SaveCookieFromDialog().catch((error) => this.ShowCookieError(error.message)));
  }

  BindFileEvents() {
    this.Elements.jsonFile.addEventListener("change", (event) => this.HandleJsonFile(event));
    this.Elements.csvFile.addEventListener("change", (event) => this.HandleCsvFile(event));
  }

  HandleKeyDown(event) {
    if (!this.Elements.cookieDialog.hidden)
      return;
    if (event.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName))
      return;
    if (event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (this.HandleControlKey(event))
      return;
    this.HandleRatingKey(event);
  }

  HandleControlKey(event) {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      this.Undo();
      return true;
    }
    if (event.key !== Config.skipKey)
      return false;
    event.preventDefault();
    this.MarkActive(null, "notSeen");
    return true;
  }

  HandleRatingKey(event) {
    if (!Object.hasOwn(Config.ratingKeys, event.key))
      return;
    event.preventDefault();
    this.MarkActive(Config.ratingKeys[event.key], "rated");
  }

  async LoadMovieData() {
    const data = await this.FetchJson(Config.dataUrl).catch((error) => this.ThrowMovieDataError(error));
    return { ...data, sourceLabel: this.DescribeSource(data, "movies.json") };
  }

  ThrowMovieDataError(error) {
    throw new Error(`Real movie data is missing. Run npm run build:data, then restart the app. ${error.message}`);
  }

  async FetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`${url} returned HTTP ${response.status}`);
    return response.json();
  }

  async LoadSavedRatingsCsv() {
    const response = await fetch(Config.ratingsCsvUrl, { cache: "no-store" }).catch(() => null);
    if (!response || response.status === 404)
      return;
    if (!response.ok)
      return;
    const count = this.ImportImdbCsv(await response.text());
    if (!count)
      return;
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  async RefreshLiveStatus() {
    const status = await this.FetchJson(Config.liveStatusUrl).catch((error) => ({ configured: false, dryRun: false, lastError: error.message }));
    this.State.live = this.BuildCheckedLiveState(status);
    this.UpdateStats();
  }

  BuildCheckedLiveState(status) {
    return {
      checked: true,
      configured: Boolean(status.configured),
      dryRun: Boolean(status.dryRun),
      submitting: false,
      lastError: status.lastError || ""
    };
  }

  ApplyMovieData(raw, sourceLabel) {
    const movies = this.NormalizeMovieList(raw);
    if (!movies.length)
      throw new Error("No valid tt-style movie IDs were found.");
    this.State.movies = movies;
    this.State.movieById = new Map(movies.map((movie) => [movie.ttId, movie]));
    this.State.sourceLabel = sourceLabel || this.DescribeSource(raw, "custom data");
    this.State.signature = this.MakeSignature(movies);
    this.RestoreLocalState();
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  NormalizeMovieList(raw) {
    const list = Array.isArray(raw) ? raw : raw.movies;
    if (!Array.isArray(list))
      return [];
    const seen = new Set();
    return list.map((item) => this.NormalizeMovie(item, seen)).filter(Boolean);
  }

  NormalizeMovie(item, seen) {
    const ttId = String(item.ttId || item.tconst || item.const || item.id || "").trim();
    if (!/^tt\d+$/.test(ttId) || seen.has(ttId))
      return null;
    const title = CleanText(item.title || item.primaryTitle || item.Title || "");
    if (!title)
      return null;
    seen.add(ttId);
    return this.BuildMovieItem(item, ttId, title);
  }

  BuildMovieItem(item, ttId, title) {
    return {
      ttId,
      title,
      year: ToNumber(item.year || item.startYear || item.Year),
      runtimeMinutes: ToNumber(item.runtimeMinutes || item.runtime),
      genres: NormalizeGenres(item.genres),
      imdbRating: ToNumber(item.imdbRating || item.averageRating),
      numVotes: ToNumber(item.numVotes || item.votes)
    };
  }

  RestoreLocalState() {
    const saved = this.ReadStoredState();
    this.State.ratings = saved.ratings || {};
    this.State.history = Array.isArray(saved.history) ? saved.history : [];
    this.State.savedQueueIds = saved.signature === this.State.signature && Array.isArray(saved.queueIds) ? saved.queueIds : null;
  }

  ReadStoredState() {
    try {
      return JSON.parse(localStorage.getItem(Config.storageKey) || "{}") || {};
    } catch {
      return {};
    }
  }

  SaveLocalState() {
    const payload = this.BuildStoragePayload();
    try {
      localStorage.setItem(Config.storageKey, JSON.stringify(payload));
    } catch {
      return;
    }
  }

  BuildStoragePayload() {
    return {
      signature: this.State.signature,
      ratings: this.State.ratings,
      history: this.State.history.slice(-200),
      queueIds: this.State.queue.map((movie) => movie.ttId)
    };
  }

  RebuildQueue() {
    const activeIds = new Set(Object.keys(this.State.ratings));
    const queuedIds = new Set();
    const savedQueue = this.BuildSavedQueue(activeIds, queuedIds);
    const freshQueue = this.State.movies.filter((movie) => !activeIds.has(movie.ttId) && !queuedIds.has(movie.ttId));
    this.State.queue = savedQueue.concat(Shuffle(freshQueue));
  }

  BuildSavedQueue(activeIds, queuedIds) {
    if (!this.State.savedQueueIds)
      return [];
    return this.State.savedQueueIds.map((ttId) => this.State.movieById.get(ttId)).filter((movie) => this.CanRestoreQueuedMovie(movie, activeIds, queuedIds));
  }

  CanRestoreQueuedMovie(movie, activeIds, queuedIds) {
    if (!movie || activeIds.has(movie.ttId) || queuedIds.has(movie.ttId))
      return false;
    queuedIds.add(movie.ttId);
    return true;
  }

  Render() {
    this.UpdateStats();
    this.Elements.sourceBadge.textContent = this.State.sourceLabel;
    if (!this.State.queue.length) {
      this.ShowComplete();
      return;
    }
    this.RenderVisibleCards();
  }

  RenderVisibleCards() {
    const visible = this.State.queue.slice(0, Config.visibleCount);
    this.Elements.empty.hidden = true;
    this.Elements.strip.innerHTML = visible.map((movie, index) => this.RenderCard(movie, index)).join("");
    requestAnimationFrame(() => this.Elements.strip.lastElementChild?.classList.add("entering"));
    this.EnrichVisibleMovies(visible);
  }

  RenderCard(movie, index) {
    const metadata = this.State.metadata[movie.ttId] || {};
    const tone = this.ToneFromId(movie.ttId);
    const className = index === 0 ? "movie-card active" : "movie-card";
    return `<article class="${className}" data-ttid="${EscapeHtml(movie.ttId)}" style="--tone: ${tone};">${this.RenderPoster(movie, metadata)}${this.RenderCardBody(movie, index, metadata)}</article>`;
  }

  RenderCardBody(movie, index, metadata) {
    const synopsis = EscapeHtml(metadata.synopsis || "Loading synopsis...");
    return `<div class="movie-body">${this.RenderPosition(movie, index)}<h2 class="title">${EscapeHtml(movie.title)}</h2><p class="synopsis">${synopsis}</p><div class="meta">${this.RenderMeta(movie)}</div></div>`;
  }

  RenderPosition(movie, index) {
    const position = `${index + 1} / ${Math.min(Config.visibleCount, this.State.queue.length)}`;
    return `<div class="position"><span>${position}</span><span>${EscapeHtml(movie.ttId)}</span></div>`;
  }

  RenderPoster(movie, metadata) {
    const year = EscapeHtml(movie.year || "");
    if (!metadata.posterUrl)
      return `<div class="poster" data-year="${year}"></div>`;
    return `<div class="poster has-image" data-year="${year}"><img class="poster-image" src="${EscapeHtml(metadata.posterUrl)}" alt=""></div>`;
  }

  RenderMeta(movie) {
    const rating = movie.imdbRating ? `<span class="pill">${EscapeHtml(movie.imdbRating.toFixed(1))} IMDb</span>` : "";
    const votes = movie.numVotes ? `<span class="pill">${FormatCount(movie.numVotes)} votes</span>` : "";
    const runtime = movie.runtimeMinutes ? `<span class="pill">${movie.runtimeMinutes} min</span>` : "";
    const genres = movie.genres.slice(0, 3).map((genre) => `<span class="pill">${EscapeHtml(genre)}</span>`).join("");
    return `${rating}${votes}${runtime}${genres}`;
  }

  EnrichVisibleMovies(movies) {
    for (const movie of movies) {
      if (this.State.metadata[movie.ttId] || this.MetadataInFlight.has(movie.ttId))
        continue;
      this.QueueMetadataRequest(movie.ttId);
    }
  }

  QueueMetadataRequest(ttId) {
    this.MetadataInFlight.add(ttId);
    this.FetchTitleMetadata(ttId).then((metadata) => this.ApplyTitleMetadata(ttId, metadata)).catch(() => this.ApplyTitleMetadata(ttId, this.BuildMissingMetadata())).finally(() => this.MetadataInFlight.delete(ttId));
  }

  BuildMissingMetadata() {
    return {
      posterUrl: "",
      synopsis: "Synopsis unavailable.",
      source: ""
    };
  }

  async FetchTitleMetadata(ttId) {
    const payload = await this.FetchJson(`${Config.titleMetadataUrl}${ttId}`);
    if (!payload.ok)
      throw new Error(payload.error || "Metadata request failed.");
    return {
      posterUrl: payload.posterUrl || "",
      synopsis: payload.synopsis || "Synopsis unavailable.",
      source: payload.source || ""
    };
  }

  ApplyTitleMetadata(ttId, metadata) {
    this.State.metadata[ttId] = metadata;
    const card = this.Elements.strip.querySelector(`[data-ttid="${ttId}"]`);
    if (!card)
      return;
    this.UpdatePoster(card, metadata);
    this.UpdateSynopsis(card, metadata);
  }

  UpdatePoster(card, metadata) {
    const poster = card.querySelector(".poster");
    if (!poster || !metadata.posterUrl)
      return;
    poster.classList.add("has-image");
    poster.innerHTML = `<img class="poster-image" src="${EscapeHtml(metadata.posterUrl)}" alt="">`;
  }

  UpdateSynopsis(card, metadata) {
    const synopsis = card.querySelector(".synopsis");
    if (synopsis)
      synopsis.textContent = metadata.synopsis || "Synopsis unavailable.";
  }

  UpdateStats() {
    const counts = this.CountRatings();
    this.Elements.rated.textContent = FormatCount(counts.rated);
    this.Elements.skipped.textContent = FormatCount(counts.skipped);
    this.Elements.imported.textContent = FormatCount(counts.imported);
    this.Elements.sent.textContent = FormatCount(counts.sent);
    this.Elements.failed.textContent = FormatCount(counts.failed);
    this.Elements.left.textContent = FormatCount(this.State.queue.length);
    this.UpdateLiveBadge(counts);
    this.UpdateFailurePanel();
  }

  CountRatings() {
    const counts = { rated: 0, skipped: 0, imported: 0, sent: 0, failed: 0, pending: 0, retryable: 0 };
    for (const item of Object.values(this.State.ratings))
      this.CountRatingItem(counts, item);
    return counts;
  }

  CountRatingItem(counts, item) {
    if (item.status === "rated")
      counts.rated++;
    if (item.status === "notSeen")
      counts.skipped++;
    if (item.status === "imported")
      counts.imported++;
    this.CountSubmitStatus(counts, item);
  }

  CountSubmitStatus(counts, item) {
    if (item.submitStatus === "submitted")
      counts.sent++;
    if (item.submitStatus === "failed")
      counts.failed++;
    if (item.submitStatus === "pending")
      counts.pending++;
    if (this.IsRetryableSubmit(item))
      counts.retryable++;
  }

  UpdateLiveBadge(counts) {
    this.UpdateCookieButton();
    this.Elements.retryFailed.disabled = !this.State.live.configured || counts.retryable === 0;
    if (!this.State.live.checked)
      return this.SetLiveBadge("badge live-missing", "Live checking");
    if (!this.State.live.configured)
      return this.SetLiveBadge("badge live-missing", "Live needs cookie");
    if (counts.failed > 0)
      return this.SetLiveBadge("badge live-failed", `Live ${FormatCount(counts.failed)} failed`);
    if (counts.pending > 0 || this.State.live.submitting)
      return this.SetLiveBadge("badge live-ready", `Live ${FormatCount(counts.pending)} pending`);
    this.SetLiveBadge("badge live-ready", this.State.live.dryRun ? "Live dry run" : "Live ready");
  }

  SetLiveBadge(className, text) {
    this.Elements.liveBadge.className = className;
    this.Elements.liveBadge.textContent = text;
  }

  UpdateCookieButton() {
    this.Elements.configureCookie.textContent = this.State.live.configured ? "Update IMDb Cookie" : "Set IMDb Cookie";
  }

  UpdateFailurePanel() {
    const ratings = Object.values(this.State.ratings);
    const failed = ratings.filter((record) => record.submitStatus === "failed");
    const failures = failed.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 5);
    if (!failures.length) {
      this.Elements.failurePanel.hidden = true;
      this.Elements.failureList.innerHTML = "";
      return;
    }
    this.Elements.failurePanel.hidden = false;
    this.Elements.failureList.innerHTML = failures.map((record) => this.RenderFailure(record)).join("");
  }

  RenderFailure(record) {
    return `<li><span>${EscapeHtml(record.title || record.ttId)}</span><code>${EscapeHtml(record.ttId)}</code><em>${EscapeHtml(record.submitError || "No error detail returned.")}</em></li>`;
  }

  MarkActive(rating, status) {
    if (this.State.locked || !this.State.queue.length)
      return;
    this.State.locked = true;
    const movie = this.State.queue[0];
    this.SaveRating(movie, rating, status);
    this.AnimateActiveCard(status);
    this.ShowRatingToast(movie, rating, status);
    window.setTimeout(() => this.AdvanceQueue(), Config.animationMs);
  }

  SaveRating(movie, rating, status) {
    const previous = this.State.ratings[movie.ttId] || null;
    this.State.ratings[movie.ttId] = this.BuildRatingRecord(movie, rating, status);
    this.State.history.push({ ttId: movie.ttId, previous });
    if (status === "rated")
      this.EnqueueLiveSubmit(movie.ttId);
  }

  BuildRatingRecord(movie, rating, status) {
    return {
      status,
      rating,
      title: movie.title,
      year: movie.year || "",
      ttId: movie.ttId,
      at: new Date().toISOString(),
      ...this.InitialSubmitState(status, rating)
    };
  }

  InitialSubmitState(status, rating) {
    if (status !== "rated")
      return { submitStatus: "skipped", submitError: "", submittedAt: "" };
    if (!Number.isInteger(rating) || rating < 1 || rating > 10)
      return { submitStatus: "localOnly", submitError: "IMDb only accepts ratings from 1 to 10.", submittedAt: "" };
    if (!this.State.live.configured)
      return { submitStatus: "notConfigured", submitError: "Live IMDb cookie is not configured.", submittedAt: "" };
    return { submitStatus: "pending", submitError: "", submittedAt: "" };
  }

  AnimateActiveCard(status) {
    const card = this.Elements.strip.firstElementChild;
    if (!card)
      return;
    card.classList.remove("active");
    card.classList.add("leaving", status === "notSeen" ? "skip" : "rated");
  }

  ShowRatingToast(movie, rating, status) {
    if (status === "rated" && rating === 0)
      return this.ShowToast(`${EscapeHtml(movie.title)} <strong>0 local only</strong>`);
    const message = status === "rated" ? `${EscapeHtml(movie.title)} <strong>${rating}</strong>` : `${EscapeHtml(movie.title)} <strong>not seen</strong>`;
    this.ShowToast(message);
  }

  AdvanceQueue() {
    this.State.queue.shift();
    this.SaveLocalState();
    this.State.locked = false;
    this.Render();
  }

  EnqueueLiveSubmit(ttId) {
    const record = this.State.ratings[ttId];
    if (!this.CanSubmitLive(record))
      return;
    record.submitStatus = "pending";
    record.submitError = "";
    this.QueueSubmitId(ttId);
    this.SaveLocalState();
    this.UpdateStats();
    this.PumpSubmitQueue();
  }

  CanSubmitLive(record) {
    if (!record)
      return false;
    const isRated = record.status === "rated";
    const isInteger = Number.isInteger(record.rating);
    const isInRange = record.rating >= 1 && record.rating <= 10;
    return isRated && this.State.live.configured && isInteger && isInRange;
  }

  QueueSubmitId(ttId) {
    if (this.SubmitQueuedIds.has(ttId))
      return;
    this.SubmitQueue.push(ttId);
    this.SubmitQueuedIds.add(ttId);
  }

  async PumpSubmitQueue() {
    if (this.SubmitInFlight || !this.SubmitQueue.length)
      return;
    const ttId = this.PopSubmitId();
    const record = this.State.ratings[ttId];
    if (!this.CanSubmitLive(record))
      return this.PumpSubmitQueue();
    await this.SubmitRatingRecord(record);
  }

  PopSubmitId() {
    const ttId = this.SubmitQueue.shift();
    this.SubmitQueuedIds.delete(ttId);
    return ttId;
  }

  async SubmitRatingRecord(record) {
    this.SetSubmitInFlight(true);
    try {
      const result = await this.PostLiveRating(record);
      this.MarkSubmitSuccess(record.ttId, result.rating ?? record.rating);
    } catch (error) {
      this.MarkSubmitFailure(record.ttId, error.message || "IMDb submit failed.");
    }
    this.ScheduleNextSubmit();
  }

  SetSubmitInFlight(value) {
    this.SubmitInFlight = value;
    this.State.live.submitting = value;
    this.UpdateStats();
  }

  async PostLiveRating(record) {
    return await this.PostJson(Config.rateUrl, { titleId: record.ttId, rating: record.rating }, "Local IMDb proxy failed.");
  }

  MarkSubmitSuccess(ttId, rating) {
    const current = this.State.ratings[ttId];
    if (!current)
      return;
    Object.assign(current, { submitStatus: "submitted", submitError: "", submittedAt: new Date().toISOString(), imdbEchoRating: rating });
    this.SaveLocalState();
    this.SyncRatingsCsvRecord(current);
  }

  MarkSubmitFailure(ttId, error) {
    const current = this.State.ratings[ttId];
    if (!current)
      return;
    Object.assign(current, { submitStatus: "failed", submitError: error, submittedAt: "" });
    this.SaveLocalState();
  }

  SyncRatingsCsvRecord(record) {
    if (this.State.live.dryRun)
      return;
    this.PostJson(Config.ratingsCsvRatingUrl, this.BuildRatingsCsvRecord(record), "Rating CSV sync failed.").catch(() => null);
  }

  BuildRatingsCsvRecord(record) {
    return {
      ttId: record.ttId,
      rating: record.rating,
      title: record.title || "",
      year: record.year || "",
      at: record.at || record.submittedAt || new Date().toISOString()
    };
  }

  ScheduleNextSubmit() {
    window.setTimeout(() => {
      this.SetSubmitInFlight(false);
      this.PumpSubmitQueue();
    }, Config.submitDelayMs);
  }

  RetryUnsent() {
    if (!this.State.live.configured)
      return this.ShowToast("<strong>Live needs cookie</strong>");
    const queued = this.QueueRetryableSubmits();
    this.ShowToast(`Queued <strong>${FormatCount(queued)}</strong> IMDb writes`);
    this.SaveLocalState();
    this.UpdateStats();
  }

  QueueRetryableSubmits() {
    let queued = 0;
    for (const record of Object.values(this.State.ratings)) {
      if (!this.IsRetryableSubmit(record))
        continue;
      record.submitStatus = "pending";
      record.submitError = "";
      this.EnqueueLiveSubmit(record.ttId);
      queued++;
    }
    return queued;
  }

  PromptForMissingCookie() {
    if (this.State.live.configured || this.State.live.dryRun)
      return;
    this.ShowCookieDialog();
  }

  ShowCookieDialog() {
    this.ShowCookieError("");
    this.Elements.cookieDialog.hidden = false;
    window.setTimeout(() => this.Elements.cookieInput.focus(), 0);
  }

  HideCookieDialog() {
    this.Elements.cookieInput.value = "";
    this.ShowCookieError("");
    this.Elements.cookieDialog.hidden = true;
  }

  async SaveCookieFromDialog() {
    const cookie = this.Elements.cookieInput.value.trim();
    if (!cookie)
      return this.ShowCookieError("Paste the full Cookie request-header value from IMDb.");
    this.SetCookieSaving(true);
    await this.PostCookie(cookie).finally(() => this.SetCookieSaving(false));
    await this.ApplySavedCookie();
  }

  async PostCookie(cookie) {
    return await this.PostJson(Config.cookieUrl, { cookie }, "Cookie save failed.");
  }

  async PostJson(url, body, message) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok)
      throw new Error(payload?.error || `${message} HTTP ${response.status}.`);
    return payload;
  }

  async ApplySavedCookie() {
    await this.RefreshLiveStatus();
    this.HideCookieDialog();
    const queued = this.QueueRetryableSubmits();
    this.ShowCookieSavedToast(queued);
  }

  ShowCookieSavedToast(queued) {
    if (queued > 0)
      return this.ShowToast(`Cookie saved. Queued <strong>${FormatCount(queued)}</strong> IMDb writes`);
    this.ShowToast("Cookie saved. <strong>Live ready</strong>");
  }

  SetCookieSaving(value) {
    this.Elements.cookieSave.disabled = value;
    this.Elements.cookieSave.textContent = value ? "Saving..." : "Save Cookie";
  }

  ShowCookieError(message) {
    this.Elements.cookieError.textContent = message || "";
  }

  IsRetryableSubmit(record) {
    if (!record)
      return false;
    const isRated = record.status === "rated";
    const isInteger = Number.isInteger(record.rating);
    const isInRange = record.rating >= 1 && record.rating <= 10;
    const isRetryableStatus = ["failed", "notConfigured", "pending"].includes(record.submitStatus);
    return isRated && isInteger && isInRange && isRetryableStatus;
  }

  Undo() {
    if (this.State.locked || !this.State.history.length)
      return;
    const last = this.State.history.pop();
    const movie = this.State.movieById.get(last.ttId);
    if (!movie)
      return;
    const touchedImdb = this.MayHaveTouchedImdb(last.ttId);
    this.RestoreHistoryItem(last, movie);
    this.ShowToast(touchedImdb ? "Restored local card; <strong>IMDb may already be updated</strong>" : `Restored <strong>${EscapeHtml(movie.title)}</strong>`);
  }

  MayHaveTouchedImdb(ttId) {
    const current = this.State.ratings[ttId];
    return current?.submitStatus === "submitted" || current?.submitStatus === "pending";
  }

  RestoreHistoryItem(last, movie) {
    if (last.previous)
      this.State.ratings[last.ttId] = last.previous;
    else
      delete this.State.ratings[last.ttId];
    if (!this.State.queue.some((queued) => queued.ttId === movie.ttId))
      this.State.queue.unshift(movie);
    this.SaveLocalState();
    this.Render();
  }

  ShowComplete() {
    const counts = this.CountRatings();
    this.Elements.strip.innerHTML = "";
    this.Elements.emptySummary.textContent = `${FormatCount(counts.rated)} rated, ${FormatCount(counts.skipped)} not seen, ${FormatCount(counts.imported)} imported.`;
    this.Elements.empty.hidden = false;
  }

  ResetAll() {
    if (!confirm("Clear local ratings, imported exclusions, and queue progress?"))
      return;
    this.State.ratings = {};
    this.State.history = [];
    this.State.savedQueueIds = null;
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  async HandleJsonFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const parsed = JSON.parse(await file.text());
    this.ApplyMovieData(parsed, file.name);
    this.ShowToast(`Loaded <strong>${FormatCount(this.State.movies.length)}</strong> titles`);
  }

  async HandleCsvFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const text = await file.text();
    const count = this.ImportImdbCsv(text);
    await this.SaveRatingsCsvText(text);
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
    this.ShowToast(`Imported and saved <strong>${FormatCount(count)}</strong> IMDb ratings`);
  }

  async SaveRatingsCsvText(text) {
    const response = await fetch(Config.ratingsCsvUrl, { method: "PUT", headers: { "content-type": "text/csv;charset=utf-8" }, body: text });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok)
      throw new Error(payload?.error || `IMDb CSV save returned HTTP ${response.status}.`);
    return payload;
  }

  TakeSelectedFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    return file;
  }

  ImportImdbCsv(text) {
    const rows = ParseCsv(text);
    if (rows.length < 2)
      return 0;
    const indexes = this.ReadCsvIndexes(rows[0]);
    if (indexes.constIndex < 0)
      throw new Error("The CSV does not include a Const column.");
    return this.ImportCsvRows(rows.slice(1), indexes);
  }

  ReadCsvIndexes(headers) {
    const normalized = headers.map((header) => header.trim().toLowerCase());
    return {
      constIndex: normalized.indexOf("const"),
      ratingIndex: normalized.indexOf("your rating"),
      titleIndex: normalized.indexOf("title"),
      yearIndex: normalized.indexOf("year"),
      dateIndex: normalized.indexOf("date rated")
    };
  }

  ImportCsvRows(rows, indexes) {
    let imported = 0;
    for (const row of rows) {
      if (this.ImportCsvRow(row, indexes))
        imported++;
    }
    return imported;
  }

  ImportCsvRow(row, indexes) {
    const ttId = (row[indexes.constIndex] || "").trim();
    if (!/^tt\d+$/.test(ttId))
      return false;
    if (this.ShouldKeepExistingRating(ttId))
      return false;
    const known = this.State.movieById.get(ttId);
    this.State.ratings[ttId] = this.BuildImportedRating(ttId, row, indexes, known);
    return true;
  }

  ShouldKeepExistingRating(ttId) {
    const existing = this.State.ratings[ttId];
    return existing?.status === "rated";
  }

  BuildImportedRating(ttId, row, indexes, known) {
    return {
      status: "imported",
      rating: indexes.ratingIndex >= 0 ? ToNumber(row[indexes.ratingIndex]) : null,
      title: known?.title || row[indexes.titleIndex] || "",
      year: known?.year || ToNumber(row[indexes.yearIndex]) || "",
      ttId,
      at: row[indexes.dateIndex] || new Date().toISOString(),
      submitStatus: "imported",
      submitError: "",
      submittedAt: ""
    };
  }

  ExportCsv() {
    const rows = [["Const", "Title", "Year", "Rating", "Status", "Submit Status", "Submit Error", "Submitted At", "Date Rated"]];
    for (const record of this.SortedRatingRecords())
      rows.push(this.ExportCsvRecord(record));
    this.Download("imdb-rapid-rater-export.csv", rows.map(ToCsvRow).join("\n"), "text/csv;charset=utf-8");
  }

  ExportCsvRecord(record) {
    return [record.ttId, record.title || "", record.year || "", record.rating ?? "", record.status, record.submitStatus || "", record.submitError || "", record.submittedAt || "", record.at || ""];
  }

  ExportJson() {
    this.Download("imdb-rapid-rater-export.json", JSON.stringify(this.SortedRatingRecords(), null, 2), "application/json;charset=utf-8");
  }

  SortedRatingRecords() {
    return Object.values(this.State.ratings).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  }

  Download(fileName, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  ShowStartupError(error) {
    console.error(error);
    this.Elements.sourceBadge.textContent = "Load failed";
    this.ShowToast(`Could not load movie data: ${EscapeHtml(error.message)}`);
  }

  ShowToast(html) {
    this.Elements.toast.innerHTML = html;
    this.Elements.toast.classList.add("show");
    window.clearTimeout(this.ToastTimer);
    this.ToastTimer = window.setTimeout(() => this.Elements.toast.classList.remove("show"), 900);
  }

  MakeSignature(movies) {
    return `${movies[0]?.ttId || ""}:${movies.length}:${movies[movies.length - 1]?.ttId || ""}`;
  }

  DescribeSource(raw, label) {
    const count = this.NormalizeMovieList(raw).length;
    return raw?.generatedAt ? `${FormatCount(count)} real titles` : `${FormatCount(count)} ${label}`;
  }

  ToneFromId(ttId) {
    const palettes = ["224, 173, 71", "96, 167, 137", "108, 145, 210", "203, 104, 99", "176, 138, 201", "209, 126, 75"];
    const hash = Array.from(ttId).reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
    return palettes[hash % palettes.length];
  }
}
