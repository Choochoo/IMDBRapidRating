import { Config } from "./config.js";
import { EscapeHtml, FormatCount } from "./util.js";
import { IsCsvSyncFailure } from "./rating-records.js";

export function RenderCard(movie, index, metadata, queueLength) {
  const tone = ToneFromId(movie.ttId);
  const className = index === 0 ? "movie-card active" : "movie-card";
  const id = EscapeHtml(movie.ttId);
  const opening = `<article class="${className}" data-ttid="${id}" style="--tone: ${tone};">`;
  return `${opening}${RenderPoster(movie, metadata)}${RenderCardBody(movie, index, metadata, queueLength)}</article>`;
}

export function UpdatePoster(card, metadata) {
  const poster = card.querySelector(".poster");
  if (!poster || !metadata.posterUrl)
    return;
  poster.classList.add("has-image");
  poster.innerHTML = `<img class="poster-image" src="${EscapeHtml(metadata.posterUrl)}" alt="">`;
}

export function UpdateRecommendationPoster(card, metadata) {
  const poster = card.querySelector(".recommendation-poster");
  if (!poster || !metadata.posterUrl)
    return;
  poster.classList.add("has-image");
  poster.innerHTML = `<img src="${EscapeHtml(metadata.posterUrl)}" alt="" loading="lazy">`;
}

export function UpdateSynopsis(card, metadata) {
  const synopsis = card.querySelector(".synopsis");
  if (synopsis)
    synopsis.textContent = metadata.synopsis || "To see the synopsis, set up a TMDB key.";
}

export function UpdateActors(card, metadata) {
  const cast = card.querySelector(".movie-cast");
  if (!cast)
    return;
  const actors = ReadActors(metadata);
  cast.hidden = actors.length === 0;
  const names = cast.querySelector("span");
  if (names)
    names.textContent = actors.join(" · ");
}

export function RenderFailure(record) {
  const title = EscapeHtml(record.title || record.ttId);
  const error = EscapeHtml(record.submitError || "No error detail returned.");
  const details = `<code>${EscapeHtml(record.ttId)}</code><b>${FailureKind(record)}</b>`;
  return `<li><span>${title}</span>${details}<em>${error}</em></li>`;
}

export function RenderModelOptions(aiState) {
  const label = EscapeHtml(aiState.selectedModel || "loading");
  const options = [`<option value="">Auto (${label})</option>`];
  if (ShouldRenderExplicitModel(aiState))
    options.push(RenderModelOption({ id: aiState.model }));
  for (const model of aiState.models)
    options.push(RenderModelOption(model));
  return options.join("");
}

export function RenderRecommendationCard(item, index = 0) {
  const title = EscapeHtml(item.title || "Untitled");
  const year = RenderRecommendationYear(item);
  const heading = `<h2>${title}${year}</h2>`;
  const genres = RenderRecommendationGenres(item);
  const eyebrow = `<div class="recommendation-card-kicker"><span>Pick ${String(index + 1).padStart(2, "0")}</span><span>Matched to you</span></div>`;
  const body = `${eyebrow}${heading}${genres}${RenderRecommendationWhy(item)}${RenderRecommendationActions(item)}`;
  const content = `<div class="recommendation-card-body">${body}</div>`;
  const tone = ToneFromId(item.ttId || item.title || String(index));
  return `<article class="recommendation-card" style="--card-index:${index};--tone:${tone}"${RenderRecommendationData(item)}>${RenderRecommendationPoster(item)}${content}</article>`;
}

export function RenderRecommendationSkeletons(count = 9) {
  return Array.from({ length: count }, (_, index) => `
    <article class="recommendation-card recommendation-skeleton" aria-hidden="true" style="--card-index:${index}">
      <div class="recommendation-poster skeleton-block"></div>
      <div class="recommendation-card-body">
        <div class="skeleton-line skeleton-kicker"></div>
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-pills"><span></span><span></span><span></span></div>
        <div class="skeleton-line skeleton-label"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-short"></div>
      </div>
    </article>`).join("");
}

export function RenderRecommendationEmpty() {
  return `<div class="recommendation-empty"><span aria-hidden="true">&#9734;</span><h2>Your recommendation watchlist is empty</h2><p>Choose how many picks you want, then generate a new batch.</p></div>`;
}

export function ToneFromId(ttId) {
  const palettes = ["224, 173, 71", "96, 167, 137", "108, 145, 210", "203, 104, 99", "176, 138, 201", "209, 126, 75"];
  const hash = Array.from(ttId).reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
  return palettes[hash % palettes.length];
}

function RenderCardBody(movie, index, metadata, queueLength) {
  const synopsis = EscapeHtml(metadata.synopsis || "Loading synopsis...");
  const title = `<h2 class="title">${EscapeHtml(movie.title)}</h2>`;
  const body = `${RenderPosition(movie, index, queueLength)}${title}${RenderActors(metadata)}<p class="synopsis">${synopsis}</p>`;
  const wishlist = index === 0 ? `<button type="button" class="movie-wishlist-action" data-add-active-to-wishlist><span aria-hidden="true">&#9734;</span> Add to wishlist</button>` : "";
  return `<div class="movie-body">${body}<div class="meta">${RenderMeta(movie)}</div>${wishlist}</div>`;
}

function RenderActors(metadata) {
  const actors = ReadActors(metadata);
  const hidden = actors.length ? "" : " hidden";
  return `<p class="movie-cast"${hidden}><strong>Starring</strong><span>${EscapeHtml(actors.join(" · "))}</span></p>`;
}

function ReadActors(metadata) {
  return (Array.isArray(metadata?.actors) ? metadata.actors : [])
    .map((actor) => String(actor || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function RenderPosition(movie, index, queueLength) {
  const visibleTotal = Math.min(Config.visibleCount, queueLength);
  const position = `${index + 1} / ${visibleTotal}`;
  return `<div class="position"><span>${position}</span><span>${EscapeHtml(movie.ttId)}</span></div>`;
}

function RenderPoster(movie, metadata) {
  const year = EscapeHtml(movie.year || "");
  if (!metadata.posterUrl)
    return `<div class="poster" data-year="${year}"></div>`;
  const image = `<img class="poster-image" src="${EscapeHtml(metadata.posterUrl)}" alt="">`;
  return `<div class="poster has-image" data-year="${year}">${image}</div>`;
}

function RenderMeta(movie) {
  const rating = RenderRatingPill(movie);
  const votes = movie.numVotes ? `<span class="pill">${FormatCount(movie.numVotes)} votes</span>` : "";
  const runtime = movie.runtimeMinutes ? `<span class="pill">${movie.runtimeMinutes} min</span>` : "";
  const genres = movie.genres.slice(0, 3).map((genre) => RenderGenrePill(genre)).join("");
  return `${rating}${votes}${runtime}${genres}`;
}

function RenderRatingPill(movie) {
  if (!movie.imdbRating)
    return "";
  return `<span class="pill">${EscapeHtml(movie.imdbRating.toFixed(1))} IMDb</span>`;
}

function FailureKind(record) {
  return IsCsvSyncFailure(record) ? "CSV sync" : "IMDb retry";
}

function ShouldRenderExplicitModel(aiState) {
  const ids = aiState.models.map((model) => model.id);
  return aiState.model && !ids.includes(aiState.model);
}

function RenderModelOption(model) {
  const id = EscapeHtml(model.id);
  return `<option value="${id}">${id}</option>`;
}

function RenderRecommendationGenres(item) {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const pills = genres.slice(0, 4).map((genre) => RenderGenrePill(genre)).join("");
  return `<div class="meta">${pills}</div>`;
}

function RenderRecommendationPoster(item) {
  const year = EscapeHtml(item.year || "");
  return `<div class="recommendation-poster" data-year="${year}" aria-hidden="true"></div>`;
}

function RenderRecommendationRating(item) {
  if (!item.ttId)
    return `<div class="recommendation-rating unavailable">No IMDb match for app rating.</div>`;
  return `<div class="recommendation-rating"><strong>Already seen?</strong>${RenderRatingButtons()}</div>`;
}

function RenderRecommendationActions(item) {
  const exclusion = `<button type="button" class="recommendation-exclusion" data-recommendation-exclusion>Don't recommend again</button>`;
  return `<div class="recommendation-card-actions">${RenderRecommendationRating(item)}${exclusion}</div>`;
}

function RenderRatingButtons() {
  const buttons = Array.from({ length: 10 }, (_, index) => RenderRatingButton(index + 1)).join("");
  return `<div class="recommendation-rate-buttons">${buttons}</div>`;
}

function RenderRatingButton(rating) {
  return `<button type="button" data-recommendation-rating="${rating}">${rating}</button>`;
}

function RenderRecommendationYear(item) {
  return item.year ? ` <span>${EscapeHtml(item.year)}</span>` : "";
}

function RenderRecommendationData(item) {
  const title = EscapeHtml(item.title || "");
  const year = EscapeHtml(item.year || "");
  const ttId = EscapeHtml(item.ttId || "");
  return ` data-ttid="${ttId}" data-title="${title}" data-year="${year}"`;
}

function RenderRecommendationWhy(item) {
  const why = item.why || {};
  const match = `<p>${EscapeHtml(why.tasteMatch || "")}</p>`;
  return `<h3>Why this fits</h3>${match}${RenderRatingEvidence(why)}`;
}

function RenderRatingEvidence(why) {
  const evidence = Array.isArray(why.ratingEvidence) ? why.ratingEvidence : [];
  const items = evidence.slice(0, 4).map((line) => `<li>${EscapeHtml(line)}</li>`).join("");
  return items ? `<ul class="recommendation-evidence">${items}</ul>` : "";
}

function RenderGenrePill(genre) {
  return `<span class="pill">${EscapeHtml(genre)}</span>`;
}
