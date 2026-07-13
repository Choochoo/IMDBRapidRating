import { Config } from "./config.js";
import { BuildRateRequest } from "./rating-records.js";
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
    return RestoreUndo(app, last, movie, BuildUndoMessage(null, null, movie));
  const current = app.State.ratings[last.ttId];
  const liveUndoDone = await TryUndoLiveRating(app, last, current);
  if (!liveUndoDone)
    return;
  RestoreUndo(app, last, movie, BuildUndoMessage(current, last.previous, movie));
}

function BlockActiveSubmit(app, ttId) {
  if (!app.SubmitActiveIds.has(ttId))
    return false;
  app.ShowToast("IMDb write is in progress; press undo again in a moment.");
  return true;
}

function CancelQueuedSubmit(app, ttId) {
  if (!app.SubmitQueuedIds.has(ttId))
    return false;
  app.SubmitQueue = app.SubmitQueue.filter((id) => id !== ttId);
  app.SubmitQueuedIds.delete(ttId);
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
    return PromptForCookie(app);
  if (ShouldRestorePreviousLive(last.previous))
    return await RestorePreviousLiveRating(app, last.previous);
  return await DeleteLiveRating(current.ttId);
}

function PromptForCookie(app) {
  app.ShowToast("<strong>IMDb cookie required</strong> to remove a submitted rating.");
  app.ShowCookieDialog();
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
  await app.PostJson(Config.rateUrl, BuildRateRequest(previous), "IMDb undo restore failed.");
  return true;
}

async function DeleteLiveRating(ttId) {
  const response = await fetch(Config.rateUrl, BuildDeleteOptions(ttId));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.error || `IMDb undo delete failed HTTP ${response.status}.`);
  return true;
}

function BuildDeleteOptions(ttId) {
  return {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ titleId: ttId })
  };
}

function RestoreUndo(app, last, movie, message) {
  app.State.history.pop();
  app.RestoreHistoryItem(last, movie);
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
