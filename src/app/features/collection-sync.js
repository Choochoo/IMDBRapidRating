import { BuildLetterboxdCsvFiles, ImportLetterboxdCsvFiles, ReconcileCollections } from "../collection-sync.js";
import { BuildLetterboxdDownload, ReadLetterboxdUpload } from "../letterboxd-zip.js";
import { BuildRatingRecord } from "../rating-records.js";
import { EscapeHtml, FormatCount } from "../util.js";
import { AnalyticsEvents } from "../analytics-events.js";

const SyncPreviewLimit = 12;
const TvMediaType = "tv";
const LetterboxdSource = "letterboxd";

export class CollectionSyncFeature {
  ReadSyncPlan() {
    if (this.State.mediaType === TvMediaType)
      return this.BuildEmptySyncPlan();
    return ReconcileCollections(this.State.ratings, this.State.letterboxd);
  }

  BuildEmptySyncPlan() {
    return {
      imdbCount: 0,
      letterboxdCount: 0,
      matched: 0,
      toImdb: [],
      toLetterboxd: [],
      conflicts: [],
      unmatched: [],
      watchedOnly: []
    };
  }

  UpdateSyncView() {
    const plan = this.ReadSyncPlan();
    this.UpdateSyncCounts(plan);
    this.UpdateSyncActions(plan);
    this.Elements.syncConflictList.innerHTML = this.RenderSyncConflicts(plan.conflicts);
    this.Elements.syncUnmatchedList.innerHTML = this.RenderSyncUnmatched(plan.unmatched);
    this.UpdateSyncSource();
    this.UpdateSyncStatus(plan);
  }

  UpdateSyncCounts(plan) {
    this.Elements.syncImdbCount.textContent = FormatCount(plan.imdbCount);
    this.Elements.syncLetterboxdCount.textContent = FormatCount(plan.letterboxdCount);
    this.Elements.syncMatchedCount.textContent = FormatCount(plan.matched);
    this.Elements.syncToImdbCount.textContent = FormatCount(plan.toImdb.length);
    this.Elements.syncToLetterboxdCount.textContent = FormatCount(plan.toLetterboxd.length);
    this.Elements.syncConflictCount.textContent = FormatCount(plan.conflicts.length);
    this.Elements.syncUnmatchedCount.textContent = FormatCount(plan.unmatched.length);
    this.Elements.syncWatchedOnlyCount.textContent = FormatCount(plan.watchedOnly.length);
  }

  UpdateSyncActions(plan) {
    const readyForImdb = plan.toImdb.some((action) => this.CanQueueSyncAction(action));
    this.Elements.syncToImdb.disabled = !this.State.live.configured || !readyForImdb;
    this.Elements.syncToLetterboxd.disabled = plan.toLetterboxd.length === 0;
  }

  UpdateSyncSource() {
    if (!this.State.letterboxd.importedAt) {
      this.Elements.syncSource.textContent = "No Letterboxd export imported yet.";
      return;
    }
    const imported = new Date(this.State.letterboxd.importedAt).toLocaleString();
    const fileCount = this.State.letterboxd.files.length;
    const sourceName = this.State.letterboxd.sourceName || "Letterboxd export";
    this.Elements.syncSource.textContent = `${sourceName} imported ${imported} from ${FormatCount(fileCount)} recognized CSV files.`;
  }

  UpdateSyncStatus(plan) {
    if (!this.State.letterboxd.importedAt) {
      this.Elements.syncStatus.textContent = "Import a Letterboxd export to compare it with the IMDb ratings in this account.";
      return;
    }
    if (this.IsSyncPlanAligned(plan)) {
      this.Elements.syncStatus.textContent = "IMDb, Letterboxd, and this account are aligned for every rated title in the imported snapshots.";
      return;
    }
    this.Elements.syncStatus.textContent = this.BuildSyncStatus(plan);
  }

  IsSyncPlanAligned(plan) {
    const ready = plan.toImdb.length + plan.toLetterboxd.length;
    const hasConflicts = plan.conflicts.length > 0;
    const hasUnmatched = plan.unmatched.length > 0;
    return !ready && !hasConflicts && !hasUnmatched;
  }

  BuildSyncStatus(plan) {
    const letterboxdCount = FormatCount(plan.toLetterboxd.length);
    const imdbCount = FormatCount(plan.toImdb.length);
    const conflictCount = FormatCount(plan.conflicts.length);
    const unmatchedCount = FormatCount(plan.unmatched.length);
    return `${letterboxdCount} ready for Letterboxd. ${imdbCount} ready for IMDb. Open “Review matches and problems” for ${conflictCount} different ratings and ${unmatchedCount} unmatched titles.`;
  }

  CanQueueSyncAction(action) {
    const ttId = action?.record?.ttId || action?.item?.ttId || "";
    return Boolean(ttId);
  }

  RenderSyncConflicts(conflicts) {
    if (!conflicts.length)
      return "<li>No conflicts.</li>";
    const preview = conflicts.slice(0, SyncPreviewLimit);
    const rendered = preview.map((item) => this.RenderSyncConflict(item));
    return rendered.join("");
  }

  RenderSyncConflict(item) {
    const year = item.year ? ` (${EscapeHtml(item.year)})` : "";
    return `<li><strong>${EscapeHtml(item.title)}</strong>${year}: IMDb ${item.imdbRating}/10, Letterboxd ${item.letterboxdRating}/10</li>`;
  }

  RenderSyncUnmatched(items) {
    if (!items.length)
      return "<li>No unmatched rated titles.</li>";
    const preview = items.slice(0, SyncPreviewLimit);
    const rendered = preview.map((item) => this.RenderSyncUnmatchedItem(item));
    return rendered.join("");
  }

  RenderSyncUnmatchedItem(item) {
    const year = item.year ? ` (${EscapeHtml(item.year)})` : "";
    return `<li><strong>${EscapeHtml(item.title)}</strong>${year}: Letterboxd ${item.rating}/10</li>`;
  }

  async HandleLetterboxdFile(event) {
    if (this.State.mediaType === TvMediaType)
      return;
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    this.Elements.syncStatus.textContent = "Reading the Letterboxd export...";
    const files = await ReadLetterboxdUpload(file);
    this.State.letterboxd = ImportLetterboxdCsvFiles(files, this.State.movieById, file.name);
    this.PersistStateNow();
    await this.FlushStateSync();
    this.UpdateSyncView();
    this.TrackProductEvent?.(AnalyticsEvents.RatingsImportCompleted, { item_count: this.State.letterboxd.items.length, source: LetterboxdSource });
    this.ShowToast(`Imported <strong>${FormatCount(this.State.letterboxd.items.length)}</strong> Letterboxd movies into this account`);
  }

  async SyncMissingRatingsToImdb() {
    if (!this.State.live.configured)
      return this.RequireImdbSignIn();
    const plan = this.ReadSyncPlan();
    const queued = this.QueueMissingRatings(plan.toImdb);
    await this.SaveQueuedSyncRatings();
    this.TrackProductEvent?.(AnalyticsEvents.SyncCompleted, { direction: "to_imdb", item_count: queued });
    this.ShowToast(`Queued <strong>${FormatCount(queued)}</strong> Letterboxd ratings for IMDb`);
  }

  QueueMissingRatings(actions) {
    let queued = 0;
    for (const action of actions) {
      const record = action.record || this.CreateLetterboxdSyncRating(action.item);
      if (!record)
        continue;
      record.submitStatus = "pending";
      record.submitError = "";
      this.StoreLetterboxdSyncRating(action, record);
      queued += 1;
    }
    return queued;
  }

  StoreLetterboxdSyncRating(action, record) {
    if (action.record)
      return;
    this.State.ratings[record.ttId] = record;
  }

  async SaveQueuedSyncRatings() {
    this.RebuildQueue();
    this.SaveLocalState();
    await this.FlushStateSync();
    await this.RefreshRaterQueue();
    this.UpdateStats();
    this.UpdateSyncView();
  }

  CreateLetterboxdSyncRating(item) {
    const hasValidId = /^tt\d+$/.test(item?.ttId || "");
    const hasValidRating = Number.isInteger(item?.rating);
    if (!hasValidId || !hasValidRating)
      return null;
    const movie = this.State.movieById.get(item.ttId) || item;
    const record = BuildRatingRecord(movie, item.rating, "rated", this.State.live.configured);
    record.at = item.ratedAt || item.watchedAt || record.at;
    record.syncSource = LetterboxdSource;
    return record;
  }

  async DownloadLetterboxdSync() {
    const plan = this.ReadSyncPlan();
    const files = BuildLetterboxdCsvFiles(plan.toLetterboxd);
    if (!files.length)
      return this.ShowToast("Letterboxd already has every rated IMDb title from the imported snapshot.");
    this.SetLetterboxdDownloadPending();
    try {
      await this.BuildAndDownloadLetterboxdFiles(files);
    } finally {
      this.ResetLetterboxdDownload();
    }
  }

  SetLetterboxdDownloadPending() {
    this.Elements.syncToLetterboxd.disabled = true;
    this.Elements.syncToLetterboxd.textContent = "Preparing download...";
  }

  ResetLetterboxdDownload() {
    this.Elements.syncToLetterboxd.textContent = "Download file to upload to Letterboxd";
    this.Elements.syncToLetterboxd.disabled = false;
  }

  async BuildAndDownloadLetterboxdFiles(files) {
    const download = await BuildLetterboxdDownload(files);
    this.Download(download.name, download.content, download.type);
    this.Elements.syncStatus.textContent = this.BuildLetterboxdDownloadStatus(files.length, download.name);
    this.TrackProductEvent?.(AnalyticsEvents.SyncCompleted, { direction: "to_letterboxd", file_count: files.length });
  }

  BuildLetterboxdDownloadStatus(fileCount, downloadName) {
    if (fileCount === 1)
      return `Downloaded ${downloadName}. Now click “Open Letterboxd import” and upload that CSV.`;
    return `Downloaded ${downloadName}. Unzip it, then upload each CSV inside to Letterboxd one at a time.`;
  }

  ShowSyncError(error) {
    const message = error?.message || "Collection sync failed.";
    this.Elements.syncStatus.textContent = message;
    this.ShowToast(EscapeHtml(message));
  }
}
