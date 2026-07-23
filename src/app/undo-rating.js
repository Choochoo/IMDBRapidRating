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
  if (!movie)
    return;
  const current = app.State.ratings[last.ttId];
  await RestoreUndo(app, last, movie, BuildUndoMessage(current, last.previous, movie));
}

function ShouldUndoLive(record) {
  return record?.submitStatus === "submitted";
}

function ShouldRestorePreviousLive(previous) {
  if (!previous || !Number.isInteger(previous.rating))
    return false;
  if (previous.rating < 1 || previous.rating > 10)
    return false;
  return previous.status === "imported" || previous.submitStatus === "submitted";
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
