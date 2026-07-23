import { MergeAccountPayload } from "../account-state-merge.js";
import { NormalizeLetterboxdState } from "../collection-sync.js";
import { BuildStoragePayload } from "../state.js";
import { UpdateTitleFilterButton } from "../title-filter-workflows.js";
import { EscapeHtml } from "../util.js";
import { NormalizeAccountPayload, ReadMediaPayload, WriteMediaPayload } from "../../../shared/media.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";
import { NormalizeTitleFilters } from "../../../shared/title-filters.js";
import { ApplyAccountSettings } from "../browser-settings.js";

const StateConflictRetryCount = 4;
const AccountRefreshIntervalMs = 15_000;
const AccountStateUrl = "/api/account/state";

export class AccountSyncFeature {
  RestoreLocalState() {
    const saved = this.ReadStoredState();
    this.State.ratings = saved.ratings || {};
    this.State.recommendationExclusions = this.NormalizeRecommendationExclusions(saved.recommendationExclusions);
    this.State.letterboxd = NormalizeLetterboxdState(saved.letterboxd, this.State.movieById);
    this.State.history = Array.isArray(saved.history) ? saved.history : [];
    this.State.filters = NormalizeTitleFilters(saved.filters);
    this.State.recommendationBasis = NormalizeRecommendationBasis(saved.recommendationBasis);
    this.State.savedQueueIds = null;
    this.UpdateRecommendationBasisControl();
    UpdateTitleFilterButton(this);
  }

  ReadStoredState() {
    return ReadMediaPayload(this.AccountPayload, this.State.mediaType);
  }

  UpdateActiveMediaPayload(partial) {
    const current = this.ReadStoredState();
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, this.State.mediaType, { ...current, ...partial });
  }

  SaveLocalState() {
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, this.State.mediaType, BuildStoragePayload(this.State));
    this.StateDirty = true;
    window.clearTimeout(this.SyncTimer);
    this.SyncTimer = window.setTimeout(() => this.RunScheduledStateSync(), 300);
  }

  PersistStateNow() {
    this.SaveLocalState();
    this.FlushStateSync().catch((error) => this.ShowStateSyncError(error));
  }

  RunScheduledStateSync() {
    this.FlushStateSync().catch((error) => this.ShowStateSyncError(error));
  }

  ShowStateSyncError(error) {
    this.ShowToast(EscapeHtml(error.message));
  }

  async FlushStateSync() {
    window.clearTimeout(this.SyncTimer);
    this.SyncPromise = this.SyncPromise.catch(() => null).then(() => this.PerformStateSync());
    return await this.SyncPromise;
  }

  async PerformStateSync() {
    let mergedAnotherDevice = false;
    for (let attempt = 0; attempt < StateConflictRetryCount; attempt++) {
      const result = await this.RequestAccountStateSave();
      const saveFailed = Object.hasOwn(result, "error");
      if (!saveFailed)
        return this.CompleteAccountStateSave(result.payloadBeingSaved, result.response, mergedAnotherDevice);
      if (!this.ResolveAccountStateConflict(result.error, attempt))
        throw result.error;
      mergedAnotherDevice = true;
    }
  }

  async RequestAccountStateSave() {
    const payloadBeingSaved = this.AccountPayload || BuildStoragePayload(this.State);
    const request = this.BuildAccountStateRequest(payloadBeingSaved);
    const save = this.RequestJson(AccountStateUrl, "PUT", request);
    const result = await save.then((response) => ({ response }), (error) => ({ error }));
    return { ...result, payloadBeingSaved };
  }

  BuildAccountStateRequest(payload) {
    return {
      payload,
      ratingsCsv: this.RatingsCsvText || "",
      revision: this.AccountRevision,
      mediaType: this.State.mediaType
    };
  }

  CompleteAccountStateSave(payloadBeingSaved, response, mergedAnotherDevice) {
    this.AccountRevision = Number(response.revision);
    if (this.AccountPayload === payloadBeingSaved)
      this.StateDirty = false;
    if (mergedAnotherDevice)
      this.ShowToast("Changes from your other device were combined and saved.");
  }

  ResolveAccountStateConflict(error, attempt) {
    const current = error?.status === 409 ? error.payload?.current : null;
    if (!current || attempt === StateConflictRetryCount - 1)
      return false;
    this.AccountPayload = MergeAccountPayload(current.payload, this.AccountPayload);
    this.RatingsCsvText ||= current.ratings_csv || current.ratingsCsv || "";
    this.AccountRevision = Number(current.revision) || 0;
    this.ApplyMergedAccountPayload(this.AccountPayload);
    return true;
  }

  StartAccountRefresh() {
    if (this.AccountRefreshTimer)
      return;
    this.AccountRefreshTimer = window.setInterval(() => this.RefreshAccountWhenVisible(), AccountRefreshIntervalMs);
  }

  RefreshAccountWhenVisible() {
    if (document.hidden)
      return;
    this.RefreshRemoteState().catch(() => null);
  }

  async RefreshRemoteState() {
    const accountChanged = await this.RefreshAccountStateFromServer().catch(() => false);
    const recommendationChanged = await this.RefreshRecommendationQueue().catch(() => false);
    const queueChanged = await this.RefreshRaterQueue().catch(() => false);
    const friendsChanged = await this.RefreshFriendships().catch(() => false);
    const socialChanged = await this.RefreshCurrentSocialContext().catch(() => false);
    return accountChanged || recommendationChanged || queueChanged || friendsChanged || socialChanged;
  }

  async RefreshAccountStateFromServer() {
    if (!this.User || this.StateDirty)
      return false;
    const account = await this.FetchJson(AccountStateUrl);
    this.ApplyImdbQueueStatus(account.imdbQueue);
    const settingsChanged = this.ApplyRemoteAccountSettings(account.settings);
    const revision = Number(account.revision) || 0;
    if (revision <= this.AccountRevision)
      return settingsChanged;
    this.ApplyRemoteAccountState(account, revision);
    return true;
  }

  ApplyRemoteAccountSettings(remote) {
    if (!remote)
      return false;
    const previous = JSON.stringify(this.Settings);
    ApplyAccountSettings(this.Settings, remote);
    if (previous === JSON.stringify(this.Settings))
      return false;
    this.ApplyShortcutUi();
    this.SyncHelpPreferenceUi();
    this.UpdateSettingsButtons();
    if (!this.ShortcutSettingsDirty)
      this.SyncShortcutSettingsForm();
    return true;
  }

  ApplyImdbQueueStatus(status) {
    if (!status)
      return;
    this.State.live.queueCounts = status.counts || {};
    this.UpdateStats();
  }

  ApplyRemoteAccountState(account, revision) {
    this.AccountPayload = NormalizeAccountPayload(account.payload);
    this.RatingsCsvText = account.ratingsCsv || "";
    this.AccountRevision = revision;
    this.ApplyMergedAccountPayload(this.AccountPayload);
    this.ShowToast("Updated with changes from your other device.");
  }

  ApplyMergedAccountPayload(payload) {
    const media = ReadMediaPayload(payload, this.State.mediaType);
    this.ApplyMergedMediaState(media);
    this.RebuildQueue();
    this.UpdateRecommendationBasisControl();
    UpdateTitleFilterButton(this);
    this.Render();
    this.UpdateSyncView();
  }

  ApplyMergedMediaState(media) {
    this.State.ratings = media.ratings || {};
    this.State.recommendationExclusions = this.NormalizeRecommendationExclusions(media.recommendationExclusions);
    this.State.letterboxd = NormalizeLetterboxdState(media.letterboxd, this.State.movieById);
    this.State.history = Array.isArray(media.history) ? media.history.slice(-200) : [];
    this.State.filters = NormalizeTitleFilters(media.filters);
    this.State.recommendationBasis = NormalizeRecommendationBasis(media.recommendationBasis);
  }
}
