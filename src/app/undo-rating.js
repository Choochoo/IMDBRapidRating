import { Config } from "./config.js";
import { EscapeHtml } from "./util.js";

export async function UndoRating(app) {
  if (app.State.locked || !app.State.history.length)
    return;
  app.State.locked = true;
  try {
    await UndoLatestRating(app);
  } finally {
    app.State.locked = false;
  }
}

async function UndoLatestRating(app) {
  const last = app.State.history[app.State.history.length - 1];
  const movie = app.State.movieById.get(last.ttId);
  if (!movie || BlockActiveSubmit(app, last.ttId))
    return;
  if (CancelQueuedSubmit(app, last.ttId))
    return await RestoreUndo(app, last, movie, BuildUndoMessage(null, null, movie));
  const current = app.State.ratings[last.ttId];
  const liveUndoDone = await TryUndoLiveRating(app, last, current);
  if (!liveUndoDone)
    return;
  await RestoreUndo(app, last, movie, BuildUndoMessage(current, last.previous, movie));
}

function BlockActiveSubmit(app, ttId) {
  if (!app.SubmitActiveIds.has(app.SubmitKey(ttId)))
    return false;
  app.ShowToast("IMDb write is in progress; press undo again in a moment.");
  return true;
}

function CancelQueuedSubmit(app, ttId) {
  const key = app.SubmitKey(ttId);
  if (!app.SubmitQueuedIds.has(key))
    return false;
  app.SubmitQueue = app.SubmitQueue.filter((item) => item.key !== key);
  app.SubmitQueuedIds.delete(key);
  return true;
}

function ShouldUndoLive(record) {
  return record?.submitStatus === "submitted";
}

async function TryUndoLiveRating(app, last, current) {
  if (!ShouldUndoLive(current))
    return true;
  return await UndoLiveRating(app, last, current);
}

async function UndoLiveRating(app, last, current) {
  if (!app.State.live.configured)
    return PromptForImdbSignIn(app);
  if (ShouldRestorePreviousLive(last.previous))
    return await RestorePreviousLiveRating(app, last.previous);
  return await DeleteLiveRating(app, current.ttId);
}

function PromptForImdbSignIn(app) {
  app.ShowToast("<strong>IMDb sign-in required</strong> to remove a submitted rating.");
  app.RequireImdbSignIn();
  return false;
}

function ShouldRestorePreviousLive(previous) {
  if (!previous || !Number.isInteger(previous.rating))
    return false;
  if (previous.rating < 1 || previous.rating > 10)
    return false;
  return previous.status === "imported" || previous.submitStatus === "submitted";
}

async function RestorePreviousLiveRating(app, previous) {
  const result = await app.PostJson(Config.rateUrl, app.BuildLiveRateRequest(previous), "IMDb undo restore failed.");
  app.AccountRevision = Math.max(app.AccountRevision, Number(result.revision) || 0);
  return true;
}

async function DeleteLiveRating(app, ttId) {
  const result = await app.RequestJson(Config.rateUrl, "DELETE", { titleId: ttId, mediaType: app.State.mediaType, deferAccountState: true });
  app.AccountRevision = Math.max(app.AccountRevision, Number(result.revision) || 0);
  return true;
}

async function RestoreUndo(app, last, movie, message) {
  await app.RestoreHistoryItem(last, movie);
  app.ShowToast(message);
}

function BuildUndoMessage(current, previous, movie) {
  const restoredPrevious = ShouldUndoLive(current) && ShouldRestorePreviousLive(previous);
  if (restoredPrevious)
    return `Restored previous IMDb rating for <strong>${EscapeHtml(movie.title)}</strong>`;
  if (ShouldUndoLive(current))
    return `Removed IMDb rating for <strong>${EscapeHtml(movie.title)}</strong>`;
  return `Restored <strong>${EscapeHtml(movie.title)}</strong>`;
}
