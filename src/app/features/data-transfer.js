import { NormalizeLetterboxdState } from "../collection-sync.js";
import { BuildCsvText, ImportImdbCsv } from "../rating-records.js";
import { BuildStoragePayload } from "../state.js";
import { CountRatings } from "../stats.js";
import { EscapeHtml, FormatCount } from "../util.js";
import { NormalizeAccountPayload, ReadMediaPayload, WriteMediaPayload } from "../../../shared/media.js";

const ImdbSaveFormat = "imdb-rapid-rater-save";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const MediaTypes = Object.freeze([MovieMediaType, TvMediaType]);

export class DataTransferFeature {
  async HandleJsonFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const parsed = JSON.parse(await file.text());
    if (this.IsRatingSave(parsed))
      return this.ImportRatingSave(parsed, file.name);
    this.ApplyMovieData(parsed, file.name);
    this.ShowToast(`Loaded <strong>${FormatCount(this.State.movies.length)}</strong> titles`);
  }

  IsRatingSave(parsed) {
    const hasSaveFormat = parsed?.format === ImdbSaveFormat;
    const hasRatings = parsed?.ratings || parsed?.state?.ratings || parsed?.state?.media;
    if (hasSaveFormat || hasRatings)
      return true;
    return Array.isArray(parsed) && parsed.some((item) => this.IsRatingRecord(item));
  }

  async ImportRatingSave(parsed, fileName) {
    if (parsed?.state?.media)
      return await this.ImportAccountBackup(parsed.state, fileName);
    const source = this.ReadRatingSaveSource(parsed);
    const ratings = this.NormalizeSavedRatings(source.ratings);
    const exclusions = this.NormalizeRecommendationExclusions(source.recommendationExclusions);
    const letterboxd = NormalizeLetterboxdState(source.letterboxd, this.State.movieById);
    if (!this.HasImportedRecords(ratings, exclusions, letterboxd))
      throw new Error("The selected JSON file does not contain any Rapid Rater records.");
    await this.ApplyImportedRatingSave(source, ratings);
    this.ShowRatingSaveRestoreToast(ratings, exclusions, fileName);
  }

  HasImportedRecords(ratings, exclusions, letterboxd) {
    const hasRatings = Object.keys(ratings).length > 0;
    const hasExclusions = exclusions.length > 0;
    const hasLetterboxdItems = letterboxd.items.length > 0;
    return hasRatings || hasExclusions || hasLetterboxdItems;
  }

  ShowRatingSaveRestoreToast(ratings, exclusions, fileName) {
    const ratingCount = FormatCount(Object.keys(ratings).length);
    const exclusionCount = FormatCount(exclusions.length);
    const skippedCount = FormatCount(CountRatings(ratings).skipped);
    this.ShowToast(`Restored <strong>${ratingCount}</strong> records and <strong>${exclusionCount}</strong> AI exclusions from ${EscapeHtml(fileName)}, including <strong>${skippedCount}</strong> not seen`);
  }

  ReadRatingSaveSource(parsed) {
    if (Array.isArray(parsed))
      return this.BuildMergedRatingSaveSource(parsed);
    const state = parsed.state || parsed;
    return {
      ratings: state.ratings || {},
      recommendationExclusions: Array.isArray(state.recommendationExclusions) ? state.recommendationExclusions : [],
      letterboxd: state.letterboxd || {},
      history: Array.isArray(state.history) ? state.history : [],
      queueIds: Array.isArray(state.queueIds) ? state.queueIds : null,
      signature: String(state.signature || ""),
      merge: false
    };
  }

  BuildMergedRatingSaveSource(ratings) {
    return {
      ratings,
      recommendationExclusions: [],
      letterboxd: {},
      history: [],
      queueIds: null,
      signature: "",
      merge: true
    };
  }

  NormalizeSavedRatings(value) {
    const records = Array.isArray(value) ? value : Object.values(value || {});
    const normalized = {};
    for (const record of records) {
      if (!this.IsRatingRecord(record))
        continue;
      normalized[record.ttId] = { ...record, ttId: String(record.ttId).trim() };
    }
    return normalized;
  }

  IsRatingRecord(record) {
    const validStatus = ["rated", "imported", "notSeen"].includes(record?.status);
    const validId = /^tt\d+$/.test(String(record?.ttId || "").trim());
    return validStatus && validId;
  }

  async ApplyImportedRatingSave(source, ratings) {
    this.ApplyImportedRatings(source, ratings);
    this.State.history = source.merge ? this.State.history : source.history.slice(-200);
    this.RebuildQueue();
    this.SaveLocalState();
    await this.FlushStateSync();
    await this.RefreshRaterQueue();
    if (Array.isArray(source.queueIds))
      await this.ReplaceRaterQueue(source.queueIds);
    this.Render();
    this.UpdateSyncView();
  }

  ApplyImportedRatings(source, ratings) {
    if (source.merge) {
      this.State.ratings = { ...this.State.ratings, ...ratings };
      return;
    }
    this.State.ratings = ratings;
    this.State.recommendationExclusions = this.NormalizeRecommendationExclusions(source.recommendationExclusions);
    this.State.letterboxd = NormalizeLetterboxdState(source.letterboxd, this.State.movieById);
  }

  async HandleCsvFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const text = await file.text();
    await this.SaveRatingsCsvText(text);
    const catalogs = await this.LoadCsvCatalogs();
    const results = this.ImportCsvMediaTypes(text, catalogs);
    await this.FinishCsvImport(results);
  }

  async LoadCsvCatalogs() {
    const [movieCatalog, tvCatalog] = await Promise.all([this.EnsureCatalog(MovieMediaType), this.EnsureCatalog(TvMediaType)]);
    return {
      [MovieMediaType]: movieCatalog,
      [TvMediaType]: tvCatalog
    };
  }

  ImportCsvMediaTypes(text, catalogs) {
    const results = {};
    for (const mediaType of MediaTypes)
      results[mediaType] = this.ImportCsvMediaType(text, catalogs, mediaType);
    return results;
  }

  ImportCsvMediaType(text, catalogs, mediaType) {
    const media = ReadMediaPayload(this.AccountPayload, mediaType);
    const ratings = this.ReadCsvRatings(media, mediaType);
    const otherMediaType = mediaType === MovieMediaType ? TvMediaType : MovieMediaType;
    const otherTitleIds = new Set(catalogs[otherMediaType].movieById.keys());
    const options = { mediaType, otherTitleIds };
    const result = ImportImdbCsv(text, ratings, catalogs[mediaType].movieById, options);
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, mediaType, { ...media, ratings });
    return result;
  }

  ReadCsvRatings(media, mediaType) {
    if (mediaType === this.State.mediaType)
      return this.State.ratings;
    return { ...(media.ratings || {}) };
  }

  async FinishCsvImport(results) {
    this.RebuildQueue();
    this.StateDirty = true;
    await this.FlushStateSync();
    await this.RefreshRaterQueue();
    this.Render();
    this.UpdateSyncView();
    this.ShowToast(this.BuildCsvSyncToast(results));
  }

  async ImportAccountBackup(value, fileName) {
    this.AccountPayload = NormalizeAccountPayload(value);
    this.ApplyMergedAccountPayload(this.AccountPayload);
    this.StateDirty = true;
    await this.FlushStateSync();
    await this.RefreshRaterQueue();
    this.ShowAccountBackupRestoreToast(fileName);
  }

  ShowAccountBackupRestoreToast(fileName) {
    const movieCount = Object.keys(ReadMediaPayload(this.AccountPayload, MovieMediaType).ratings || {}).length;
    const tvCount = Object.keys(ReadMediaPayload(this.AccountPayload, TvMediaType).ratings || {}).length;
    this.ShowToast(`Restored <strong>${FormatCount(movieCount)}</strong> movie and <strong>${FormatCount(tvCount)}</strong> TV records from ${EscapeHtml(fileName)}`);
  }

  BuildCsvSyncToast(results) {
    const movieCount = FormatCount(results.movie?.count || 0);
    const tvCount = FormatCount(results.tv?.count || 0);
    const removed = Number(results.movie?.removed || 0) + Number(results.tv?.removed || 0);
    const suffix = removed ? ` Removed <strong>${FormatCount(removed)}</strong> stale imported ratings.` : "";
    return `Synced <strong>${movieCount}</strong> movie and <strong>${tvCount}</strong> TV ratings from IMDb.${suffix}`;
  }

  async SaveRatingsCsvText(text) {
    this.RatingsCsvText = text;
    return { ok: true };
  }

  TakeSelectedFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    return file;
  }

  ExportCsv() {
    const csv = BuildCsvText(this.State.ratings);
    const suffix = this.State.mediaType === TvMediaType ? "tv-shows" : "movies";
    this.Download(`imdb-rapid-rater-${suffix}-export.csv`, csv, "text/csv;charset=utf-8");
  }

  ExportJson() {
    const save = this.BuildJsonSave();
    this.Download("imdb-rapid-rater-save.json", JSON.stringify(save, null, 2), "application/json;charset=utf-8");
  }

  BuildJsonSave() {
    const active = {
      ...BuildStoragePayload(this.State),
      signature: this.State.signature,
      queueIds: Array.isArray(this.State.savedQueueIds) ? this.State.savedQueueIds : []
    };
    const accountPayload = WriteMediaPayload(this.AccountPayload, this.State.mediaType, active);
    return {
      format: ImdbSaveFormat,
      version: 5,
      exportedAt: new Date().toISOString(),
      state: accountPayload
    };
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
}
