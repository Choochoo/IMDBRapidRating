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

export function UpdateSynopsis(card, metadata) {
  const synopsis = card.querySelector(".synopsis");
  if (synopsis)
    synopsis.textContent = metadata.synopsis || "Synopsis unavailable.";
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

export function RenderRecommendationCard(item) {
  const title = EscapeHtml(item.title || "Untitled");
  const year = item.year ? ` <span>${EscapeHtml(item.year)}</span>` : "";
  const heading = `<h2>${title}${year}</h2>`;
  const genres = RenderRecommendationGenres(item);
  return `<article class="recommendation-card">${heading}${genres}${RenderRecommendationWhy(item)}</article>`;
}

export function ToneFromId(ttId) {
  const palettes = ["224, 173, 71", "96, 167, 137", "108, 145, 210", "203, 104, 99", "176, 138, 201", "209, 126, 75"];
  const hash = Array.from(ttId).reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
  return palettes[hash % palettes.length];
}

function RenderCardBody(movie, index, metadata, queueLength) {
  const synopsis = EscapeHtml(metadata.synopsis || "Loading synopsis...");
  const title = `<h2 class="title">${EscapeHtml(movie.title)}</h2>`;
  const body = `${RenderPosition(movie, index, queueLength)}${title}<p class="synopsis">${synopsis}</p>`;
  return `<div class="movie-body">${body}<div class="meta">${RenderMeta(movie)}</div></div>`;
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
