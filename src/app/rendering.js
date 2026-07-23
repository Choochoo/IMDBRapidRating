import { EscapeHtml, FormatCount } from "./util.js";
import { IsCsvSyncFailure } from "./rating-records.js";
import { RecommendationSortFields, TvMediaType } from "./app-constants.js";

export const MissingSynopsis = "No synopsis is available for this title.";
export const MissingStreamingAvailability = "No watching options are available for this title.";
const MetaBadgeClass = "badge rounded-pill text-bg-dark border";
const HrefAttribute = "href";
const MetadataSeparator = " · ";
const PosterImageClass = "poster-image";
const RecommendationSortValueClass = "recommendation-tile-sort-value";
const RecommendationSortValueClassAttribute = ` class="${RecommendationSortValueClass}"`;
const HiddenAttribute = " hidden";
const UntitledLabel = "Untitled";
const SpaceSeparator = " ";

export function RenderCard(movie, index, metadata) {
  const tone = ToneFromId(movie.ttId);
  const className = index === 0 ? "movie-card card active" : "movie-card card";
  const id = EscapeHtml(movie.ttId);
  const opening = `<article class="${className}" data-ttid="${id}" style="--tone: ${tone};">`;
  return `${opening}${RenderPoster(movie, metadata)}${RenderCardBody(movie, index, metadata)}</article>`;
}

export function UpdatePoster(card, metadata) {
  const poster = card.querySelector(".poster");
  if (!poster || !metadata.posterUrl)
    return;
  UpdatePosterImage(poster, metadata.posterUrl, PosterImageClass, false);
}

export function UpdateRecommendationPoster(card, metadata) {
  const poster = card.querySelector(".recommendation-poster");
  if (!poster || !metadata.posterUrl)
    return;
  UpdatePosterImage(poster, metadata.posterUrl, "recommendation-poster-image", true);
}

function UpdatePosterImage(poster, posterUrl, className, lazy) {
  poster.classList.add("has-image");
  const image = poster.querySelector(`.${className}`);
  if (image)
    return image.setAttribute("src", posterUrl);
  const loading = lazy ? ` loading="lazy"` : "";
  poster.insertAdjacentHTML("afterbegin", `<img class="${className}" src="${EscapeHtml(posterUrl)}" alt=""${loading}>`);
}

export function UpdateSynopsis(card, metadata) {
  const synopsis = card.querySelector(".synopsis");
  if (synopsis)
    synopsis.textContent = metadata.synopsis || MissingSynopsis;
}

export function UpdateActors(card, metadata) {
  const cast = card.querySelector(".movie-cast");
  if (!cast)
    return;
  const actors = ReadActors(metadata);
  cast.hidden = actors.length === 0;
  const names = cast.querySelector("span");
  if (names)
    names.textContent = actors.join(MetadataSeparator);
}

export function UpdateTrailerLink(card, metadata) {
  const link = card.querySelector("[data-trailer-link]");
  if (!link)
    return;
  const url = ReadTrailerUrl(metadata);
  link.hidden = !url;
  if (url)
    link.setAttribute(HrefAttribute, url);
  else
    link.removeAttribute(HrefAttribute);
}

export function UpdateSeriesDetails(card, movie, metadata) {
  const details = card.querySelector(".series-details");
  if (details)
    details.innerHTML = RenderSeriesDetailsContent(movie, metadata);
}

export function UpdateStreamingAvailability(card, metadata) {
  const container = card.querySelector("[data-streaming-availability]");
  if (!container)
    return;
  const content = RenderStreamingAvailabilityContent(metadata?.streamingAvailability) || RenderStreamingEmpty();
  container.hidden = false;
  container.innerHTML = content;
}

export function RenderFailure(record) {
  const title = EscapeHtml(record.title || record.ttId);
  const error = EscapeHtml(record.submitError || "No error detail returned.");
  const details = `<code>${EscapeHtml(record.ttId)}</code><b>${FailureKind(record)}</b>`;
  return `<li><span>${title}</span>${details}<em>${error}</em></li>`;
}

export function RenderRecommendationCard(item, index = 0, sortField = RecommendationSortFields.addedAt) {
  const title = EscapeHtml(item.title || UntitledLabel);
  const tone = ToneFromId(item.ttId || item.title || String(index));
  const label = `Open details for ${title}`;
  const content = `<span class="recommendation-tile-copy"><strong${RenderRecommendationTitleClass(sortField)}>${title}</strong>${RenderRecommendationTileFacts(item, sortField)}</span>`;
  const poster = `<div class="recommendation-poster-stack"><button type="button" class="recommendation-tile-button" data-recommendation-details aria-label="${label}">${RenderRecommendationPoster(item)}</button><button type="button" class="recommendation-watch-button btn btn-primary" data-recommendation-watch aria-label="Where to Watch for ${title}">Where to Watch</button></div>`;
  return `<article class="recommendation-card" style="--card-index:${index};--tone:${tone}"${RenderRecommendationData(item)}>${poster}${content}</article>`;
}

export function RenderRecommendationDetails(item) {
  const heading = RenderRecommendationHeading(item);
  const kicker = `<div class="recommendation-card-kicker"><span>Saved to watchlist</span><span>${FormatRelativeDate(item.addedAt)}</span></div>`;
  const body = `${kicker}${heading}${RenderRecommendationGenres(item)}${RenderRecommendationWhy(item)}${RenderRecommendationActions(item)}`;
  return `<article class="recommendation-details-card"${RenderRecommendationData(item)}>${RenderRecommendationPoster(item)}<div class="recommendation-card-body d-flex flex-column">${body}</div></article>`;
}

export function RenderRecommendationWatch(item, metadata = {}) {
  const heading = RenderRecommendationHeading(item);
  const body = `<span class="recommendation-kicker">Watching options</span>${heading}${RenderRecommendationStreaming(metadata)}`;
  return `<article class="recommendation-watch-dialog-card"${RenderRecommendationData(item)}>${body}</article>`;
}

export function RenderRecommendationSkeletons(count = 9) {
  return Array.from({ length: count }, (_, index) => RenderRecommendationSkeleton(index)).join("");
}

function RenderRecommendationSkeleton(index) {
  return `
    <article class="recommendation-card recommendation-skeleton" aria-hidden="true" style="--card-index:${index}">
      <div class="recommendation-poster skeleton-block"></div>
      <div class="recommendation-tile-copy">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-short"></div>
      </div>
    </article>`;
}

export function RenderRecommendationEmpty() {
  return `<div class="recommendation-empty"><span aria-hidden="true">&#9734;</span><h2>Your watchlist is empty</h2><p>Open Generate picks to build your first batch.</p></div>`;
}

export function RenderRecommendationFilteredEmpty() {
  return `<div class="recommendation-empty"><span aria-hidden="true">&#9671;</span><h2>No saved titles fit these filters</h2><p>Change the active filters to bring saved titles back.</p></div>`;
}

export function FormatRelativeDate(value, now = Date.now()) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp))
    return "Recently added";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60)
    return "Just added";
  if (seconds < 3600)
    return FormatRelativeUnit(seconds / 60, "minute");
  if (seconds < 86400)
    return FormatRelativeUnit(seconds / 3600, "hour");
  return FormatRelativeDays(seconds / 86400);
}

export function ToneFromId(ttId) {
  const palettes = ["224, 173, 71", "96, 167, 137", "108, 145, 210", "203, 104, 99", "176, 138, 201", "209, 126, 75"];
  const hash = Array.from(ttId).reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
  return palettes[hash % palettes.length];
}

function RenderCardBody(movie, index, metadata) {
  const synopsis = EscapeHtml(metadata.synopsis || "Loading synopsis...");
  const title = `<h2 class="title">${EscapeHtml(movie.title)}</h2>`;
  const series = movie.mediaType === TvMediaType ? `<div class="series-details">${RenderSeriesDetailsContent(movie, metadata)}</div>` : "";
  const body = `${RenderMovieId(movie)}${title}${series}${RenderActors(metadata)}<p class="synopsis">${synopsis}</p>`;
  const wishlist = index === 0 ? `<button type="button" class="movie-wishlist-action btn btn-primary" data-add-active-to-wishlist><span aria-hidden="true">&#9734;</span> Add to watchlist</button>` : "";
  const trailer = index === 0 ? RenderTrailerLink(metadata, "movie-trailer-link") : "";
  const actions = index === 0 ? `<div class="movie-card-actions d-grid">${trailer}${wishlist}</div>` : "";
  return `<div class="movie-body">${body}<div class="meta d-flex flex-wrap">${RenderMeta(movie)}</div>${actions}</div>`;
}

function RenderRecommendationStreaming(metadata) {
  if (!metadata.streamingRequested)
    return RenderStreamingLoading();
  const content = RenderStreamingAvailabilityContent(metadata.streamingAvailability) || RenderStreamingEmpty();
  return `<section class="streaming-availability" data-streaming-availability>${content}</section>`;
}

function RenderStreamingLoading() {
  const heading = `<div class="streaming-heading"><div><span>Where to watch</span></div><span class="streaming-refreshing">Loading</span></div>`;
  return `<section class="streaming-availability" data-streaming-availability>${heading}<p class="streaming-empty">Checking streaming, rental, and purchase options…</p></section>`;
}

export function RenderStreamingAvailability(availability) {
  const content = RenderStreamingAvailabilityContent(availability);
  const hidden = content ? "" : HiddenAttribute;
  return `<section class="streaming-availability" data-streaming-availability${hidden}>${content}</section>`;
}

function RenderStreamingAvailabilityContent(availability) {
  if (!availability || typeof availability !== "object" || Array.isArray(availability))
    return "";
  const country = /^[A-Z]{2}$/.test(String(availability.country || "")) ? availability.country : "US";
  const providers = Array.isArray(availability.providers) ? availability.providers : [];
  const groups = RenderStreamingProviderGroups(providers);
  const empty = groups ? "" : RenderStreamingEmpty();
  return `${RenderStreamingHeading(country, availability)}${groups}${empty}${RenderStreamingFooter(availability.watchUrl)}`;
}

function RenderStreamingEmpty() {
  return `<p class="streaming-empty">${MissingStreamingAvailability}</p>`;
}

function RenderStreamingProviderGroups(providers) {
  const groups = [
    RenderStreamingProviderGroup("Stream", "subscription", providers),
    RenderStreamingProviderGroup("Free", "free", providers),
    RenderStreamingProviderGroup("With ads", "ads", providers),
    RenderStreamingProviderGroup("Rent", "rent", providers),
    RenderStreamingProviderGroup("Buy", "buy", providers)
  ];
  return groups.filter(Boolean).join("");
}

function RenderStreamingHeading(country, availability) {
  const refreshing = availability.refreshing ? `<span class="streaming-refreshing">Refreshing</span>` : "";
  return `<div class="streaming-heading"><div><span>Where to watch</span><strong>${EscapeHtml(country)}</strong></div>${refreshing}</div>`;
}

function RenderStreamingFooter(value) {
  const watchUrl = ReadWebUrl(value);
  const link = watchUrl ? `<a class="streaming-watch-link" href="${EscapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">View all watching options</a>` : "";
  return `<div class="streaming-footer">${link}<small>Streaming data provided by <a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a> via TMDB.</small></div>`;
}

function RenderStreamingProviderGroup(label, type, providers) {
  const matchingProviders = providers.filter((provider) => provider?.type === type && provider?.name);
  const matches = matchingProviders.slice(0, 4);
  if (!matches.length)
    return "";
  const chips = matches.map(RenderStreamingProvider).join("");
  const overflowCount = matchingProviders.length - matches.length;
  const overflow = overflowCount ? `<span class="streaming-provider-more">+${overflowCount} more</span>` : "";
  return `<div class="streaming-provider-group"><span>${EscapeHtml(label)}</span><div class="streaming-provider-list">${chips}${overflow}</div></div>`;
}

function RenderStreamingProvider(provider) {
  const rawName = String(provider.name || "").replace(/\s+/g, SpaceSeparator).trim();
  const name = EscapeHtml(rawName);
  const logoUrl = BuildProviderLogoUrl(provider.logoPath);
  const logo = logoUrl ? `<img src="${EscapeHtml(logoUrl)}" alt="" loading="lazy">` : `<span class="streaming-provider-fallback" aria-hidden="true">${EscapeHtml(rawName.slice(0, 1))}</span>`;
  return `<span class="streaming-provider" role="img" aria-label="${name}" title="${name}">${logo}<span class="streaming-provider-name">${name}</span></span>`;
}

function BuildProviderLogoUrl(value) {
  const path = String(value || "").trim();
  const hasSupportedCharacters = /^\/[a-z0-9._/-]+$/i.test(path);
  const hasParentTraversal = path.includes("..");
  if (!hasSupportedCharacters || hasParentTraversal)
    return "";
  return `https://image.tmdb.org/t/p/w92${path}`;
}

function RenderSeriesDetailsContent(show, metadata) {
  const run = show.endYear ? `${show.year}–${show.endYear}` : `${show.year}–Present`;
  const facts = [run];
  if (metadata.seriesStatus)
    facts.push(metadata.seriesStatus);
  if (metadata.seasonCount)
    facts.push(`${metadata.seasonCount} ${metadata.seasonCount === 1 ? "season" : "seasons"}`);
  if (metadata.episodeCount)
    facts.push(`${metadata.episodeCount} episodes`);
  const runtime = metadata.episodeRuntimeMinutes || show.runtimeMinutes;
  if (runtime)
    facts.push(`${runtime} min episodes`);
  return facts.map((fact) => `<span class="badge rounded-pill">${EscapeHtml(fact)}</span>`).join("");
}

function RenderActors(metadata) {
  const actors = ReadActors(metadata);
  const hidden = actors.length ? "" : HiddenAttribute;
  return `<p class="movie-cast"${hidden}><strong>Starring</strong><span>${EscapeHtml(actors.join(MetadataSeparator))}</span></p>`;
}

function ReadActors(metadata) {
  return (Array.isArray(metadata?.actors) ? metadata.actors : []).map((actor) => String(actor || "").replace(/\s+/g, SpaceSeparator).trim()).filter(Boolean).slice(0, 3);
}

function RenderTrailerLink(metadata, className) {
  const url = ReadTrailerUrl(metadata);
  const hidden = url ? "" : HiddenAttribute;
  const href = url ? ` href="${EscapeHtml(url)}"` : "";
  return `<a class="${className} btn btn-outline-info" data-trailer-link${href} target="_blank" rel="noopener noreferrer"${hidden}><span aria-hidden="true">&#9654;</span> Watch trailer</a>`;
}

function ReadTrailerUrl(metadata) {
  return ReadWebUrl(metadata?.trailerUrl);
}

function ReadWebUrl(value) {
  const rawUrl = String(value || "");
  if (!URL.canParse(rawUrl))
    return "";
  const url = new URL(rawUrl);
  return ["http:", "https:"].includes(url.protocol) ? url.href : "";
}

function RenderMovieId(movie) {
  return `<div class="movie-id">${EscapeHtml(movie.ttId)}</div>`;
}

function RenderPoster(movie, metadata) {
  const year = EscapeHtml(movie.year || "");
  if (!metadata.posterUrl)
    return `<div class="poster" data-year="${year}"></div>`;
  const image = `<img class="${PosterImageClass}" src="${EscapeHtml(metadata.posterUrl)}" alt="">`;
  return `<div class="poster has-image" data-year="${year}">${image}</div>`;
}

function RenderMeta(movie) {
  const rating = RenderRatingPill(movie);
  const votes = movie.numVotes ? `<span class="${MetaBadgeClass}">${FormatCount(movie.numVotes)} votes</span>` : "";
  const runtime = movie.mediaType !== TvMediaType && movie.runtimeMinutes ? `<span class="${MetaBadgeClass}">${movie.runtimeMinutes} min</span>` : "";
  const genres = movie.genres.slice(0, 3).map((genre) => RenderGenrePill(genre)).join("");
  return `${rating}${votes}${runtime}${genres}`;
}

function RenderRatingPill(movie) {
  if (!movie.imdbRating)
    return "";
  return `<span class="${MetaBadgeClass}">${EscapeHtml(movie.imdbRating.toFixed(1))} IMDb</span>`;
}

function FailureKind(record) {
  return IsCsvSyncFailure(record) ? "CSV sync" : "IMDb retry";
}

function RenderRecommendationGenres(item) {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const pills = genres.slice(0, 4).map((genre) => RenderGenrePill(genre)).join("");
  return `<div class="meta d-flex flex-wrap">${pills}</div>`;
}

function RenderRecommendationTileFacts(item, sortField) {
  const yearClass = sortField === RecommendationSortFields.year ? RecommendationSortValueClassAttribute : "";
  const year = item.year ? `<span${yearClass}>${EscapeHtml(item.year)}</span>` : "";
  return `<small>${year}${RenderRecommendationSortValue(item, sortField)}</small>`;
}

function RenderRecommendationSortValue(item, sortField) {
  if (sortField === RecommendationSortFields.imdbRating)
    return `<span class="${RecommendationSortValueClass}">${FormatRecommendationRating(item.imdbRating)}</span>`;
  if (sortField !== RecommendationSortFields.addedAt)
    return "";
  return `<span class="${RecommendationSortValueClass}">${FormatRelativeDate(item.addedAt)}</span>`;
}

function RenderRecommendationTitleClass(sortField) {
  return sortField === RecommendationSortFields.title ? RecommendationSortValueClassAttribute : "";
}

function FormatRecommendationRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0)
    return "Unrated";
  return `${rating.toFixed(1)} IMDb`;
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
  const exclusion = `<button type="button" class="recommendation-exclusion btn btn-sm btn-outline-secondary" data-recommendation-exclusion>Don't recommend again</button>`;
  const share = `<button type="button" class="btn btn-sm btn-primary" data-share-recommendation>Share with friends</button>`;
  const trailer = RenderTrailerLink({}, "recommendation-trailer-link");
  return `<div class="recommendation-card-actions d-grid">${RenderRecommendationRating(item)}${trailer}${share}${exclusion}</div>`;
}

function RenderRatingButtons() {
  const buttons = Array.from({ length: 10 }, (_, index) => RenderRatingButton(index + 1)).join("");
  return `<div class="recommendation-rate-buttons d-grid">${buttons}</div>`;
}

function RenderRatingButton(rating) {
  return `<button type="button" class="btn btn-sm btn-outline-secondary" data-recommendation-rating="${rating}">${rating}</button>`;
}

function RenderRecommendationYear(item) {
  return item.year ? ` <span>${EscapeHtml(item.year)}</span>` : "";
}

function RenderRecommendationData(item) {
  const title = EscapeHtml(item.title || "");
  const year = EscapeHtml(item.year || "");
  const ttId = EscapeHtml(item.ttId || "");
  return ` data-recommendation-item data-ttid="${ttId}" data-title="${title}" data-year="${year}"`;
}

function RenderRecommendationHeading(item) {
  const title = EscapeHtml(item.title || UntitledLabel);
  return `<h2 id="recommendation-details-title">${title}${RenderRecommendationYear(item)}</h2>`;
}

function RenderRecommendationWhy(item) {
  const why = item.why || {};
  const match = `<p>${EscapeHtml(why.tasteMatch || "")}</p>`;
  return `<h3>Why this fits</h3>${match}${RenderRatingEvidence(why)}`;
}

function RenderRatingEvidence(why) {
  const evidence = Array.isArray(why.ratingEvidence) ? why.ratingEvidence : [];
  const items = evidence.slice(0, 4).map((line) => `<li>${EscapeHtml(line)}</li>`).join("");
  return items ? `<ul class="recommendation-evidence d-grid">${items}</ul>` : "";
}

function RenderGenrePill(genre) {
  return `<span class="${MetaBadgeClass}">${EscapeHtml(genre)}</span>`;
}

function FormatRelativeDays(value) {
  if (value < 30)
    return FormatRelativeUnit(value, "day");
  if (value < 365)
    return FormatRelativeUnit(value / 30, "month");
  return FormatRelativeUnit(value / 365, "year");
}

function FormatRelativeUnit(value, unit) {
  const count = Math.max(1, Math.floor(value));
  const label = count === 1 ? unit : `${unit}s`;
  return `${count} ${label} ago`;
}
