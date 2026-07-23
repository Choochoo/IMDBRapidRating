import { Config } from "./config.js";
import { ClickEvent } from "./app-constants.js";
import { BuildRatingRecord } from "./rating-records.js";
import { EscapeHtml } from "./util.js";

const RecommendationExclusionSelector = "[data-recommendation-exclusion]";
const RecommendationRatingSelector = "[data-recommendation-rating]";

export function BindRecommendationRatings(app) {
  app.Elements.recommendationGrid.addEventListener(ClickEvent, (event) => HandleRatingClick(app, event));
  app.Elements.recommendationDetailsContent.addEventListener(ClickEvent, (event) => HandleRatingClick(app, event));
}

function HandleRatingClick(app, event) {
  const action = ReadRecommendationAction(event.target);
  if (action)
    return action(app);
  const button = ReadRatingButton(event.target);
  if (!button)
    return;
  RateRecommendation(app, button).catch((error) => app.ShowRecommendationError(error.message));
}

function ReadRecommendationAction(target) {
  const watchButton = ReadWatchButton(target);
  if (watchButton)
    return (app) => app.ShowRecommendationWatch(watchButton);
  const detailsButton = ReadDetailsButton(target);
  if (detailsButton)
    return (app) => app.ShowRecommendationDetails(detailsButton);
  const shareButton = ReadShareButton(target);
  if (shareButton)
    return (app) => app.OpenShareDialog(shareButton);
  const exclusionButton = ReadExclusionButton(target);
  if (exclusionButton)
    return (app) => ExcludeRecommendation(app, exclusionButton);
  return null;
}

function ReadWatchButton(target) {
  if (!target?.closest)
    return null;
  return target.closest("[data-recommendation-watch]");
}

function ReadShareButton(target) {
  if (!target?.closest)
    return null;
  return target.closest("[data-share-recommendation]");
}

function ReadDetailsButton(target) {
  if (!target?.closest)
    return null;
  return target.closest("[data-recommendation-details]");
}

function ReadExclusionButton(target) {
  if (!target?.closest)
    return null;
  return target.closest(RecommendationExclusionSelector);
}

function ReadRatingButton(target) {
  if (!target?.closest)
    return null;
  return target.closest(RecommendationRatingSelector);
}

async function RateRecommendation(app, button) {
  if (!app.State.live.configured)
    return app.RequireImdbSignIn();
  const card = ReadRecommendationContainer(button);
  if (!card)
    return;
  await SaveRecommendationRating(app, card, button);
}

async function SaveRecommendationRating(app, card, button) {
  const request = app.BuildLiveRateRequest(BuildRecommendationRateRecord(app, card, button));
  SetCardSaving(card, true);
  const payload = await app.PostJson(Config.rateUrl, request).finally(() => SetCardSaving(card, false));
  ApplyRecommendationRating(app, card, request, payload);
}

function BuildRecommendationRateRecord(app, card, button) {
  return {
    ttId: card.dataset.ttid || "",
    rating: Number(button.dataset.recommendationRating),
    title: card.dataset.title || "",
    year: card.dataset.year || "",
    mediaType: app.State.mediaType,
    at: new Date().toISOString()
  };
}

function ExcludeRecommendation(app, button) {
  const card = ReadRecommendationContainer(button);
  if (!card)
    return;
  const record = {
    ttId: card.dataset.ttid || "",
    title: card.dataset.title || "",
    year: card.dataset.year || "",
    at: new Date().toISOString()
  };
  const exclusion = app.AddRecommendationExclusion(record);
  if (!exclusion)
    return app.ShowRecommendationError("This recommendation could not be saved to the exclusion list.");
  app.ShowToast(`<strong>${EscapeHtml(exclusion.title)}</strong> won't be recommended again`);
}

function ApplyRecommendationRating(app, card, request, payload) {
  const record = SaveLocalRating(app, request, payload);
  app.RemoveRecommendationFromQueue(record);
  app.ShowToast(`${EscapeHtml(record.title)} <strong>${record.rating}</strong>`);
}

function SaveLocalRating(app, request, payload) {
  const movie = BuildRatedMovie(request, payload);
  const previous = app.State.ratings[movie.ttId] || null;
  app.State.ratings[movie.ttId] = BuildRatingRecord(movie, movie.rating, "rated", app.State.live.configured);
  MarkSubmitSuccess(app.State.ratings[movie.ttId], payload);
  app.AccountRevision = Math.max(app.AccountRevision, Number(payload.revision) || 0);
  return FinishLocalRating(app, movie, previous);
}

function BuildRatedMovie(request, payload) {
  return {
    ttId: request.titleId,
    title: request.title,
    year: request.year,
    mediaType: request.mediaType,
    rating: payload.rating ?? request.rating
  };
}

function MarkSubmitSuccess(record, payload) {
  if (payload.queued)
    return Object.assign(record, { submitStatus: "pending", submitError: "", submittedAt: "" });
  const submitState = {
    submitStatus: "submitted",
    submitError: "",
    submittedAt: new Date().toISOString(),
    imdbEchoRating: payload.rating ?? record.rating
  };
  Object.assign(record, submitState);
}

function FinishLocalRating(app, movie, previous) {
  app.State.history.push({ ttId: movie.ttId, previous });
  app.RebuildQueue();
  app.PersistStateNow();
  app.UpdateStats();
  return app.State.ratings[movie.ttId];
}

function SetCardSaving(card, value) {
  card.classList.toggle("saving", value);
  for (const button of card.querySelectorAll(RecommendationRatingSelector))
    button.disabled = value;
  const exclusion = card.querySelector(RecommendationExclusionSelector);
  if (exclusion)
    exclusion.disabled = value;
}

function ReadRecommendationContainer(element) {
  return element.closest("[data-recommendation-item]");
}
