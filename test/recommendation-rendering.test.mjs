import assert from "node:assert/strict";
import test from "node:test";
import { RecommendationSortFields } from "../src/app/app-constants.js";
import { FormatRelativeDate, MissingStreamingAvailability, RenderCard, RenderRecommendationCard, RenderRecommendationDetails, RenderRecommendationEmpty, RenderRecommendationSkeletons, RenderRecommendationWatch, UpdateActors, UpdateStreamingAvailability, UpdateSynopsis, UpdateTrailerLink } from "../src/app/rendering.js";

const CrimeGenre = "Crime";
const DramaGenre = "Drama";
const HeatData = { ttId: "tt0113277", title: "Heat", year: 1995, genres: [CrimeGenre] };
const Heat = Object.freeze(HeatData);
const TrailerUrl = "https://www.youtube.com/watch?v=trailer";
const WhereToWatchLabel = "Where to watch";
const NetflixName = "Netflix";
const ActorNames = Object.freeze(["Al Pacino", "Robert De Niro", "Val Kilmer"]);
const ActorSummary = ActorNames.join(" · ");
const RecommendationDetailsTitleId = "recommendation-details-title";
const StreamingCountry = "US";
const StreamingSelector = "[data-streaming-availability]";
const StreamingAvailabilityData = {
  country: StreamingCountry,
  watchUrl: "https://www.themoviedb.org/movie/949/watch?locale=US",
  providers: [
    { type: "subscription", id: 8, name: NetflixName, logoPath: "/netflix.jpg" },
    { type: "rent", id: 2, name: "Apple TV", logoPath: "/apple.jpg" }
  ]
};
const StreamingAvailability = Object.freeze(StreamingAvailabilityData);

test("recommendation loading renders eight cinematic placeholders", VerifyRecommendationSkeletons);
test("recommendation tiles stay compact and escape generated text", VerifyRecommendationCard);
test("recommendation details retain explanations and actions", VerifyRecommendationDetails);
test("recommendation tiles format relative date-added labels", VerifyRecommendationRelativeDate);
test("recommendation tiles display the active sort value", VerifyRecommendationSortMetadata);
test("empty recommendation queue explains how to add picks", VerifyRecommendationEmpty);
test("only the active rating card offers the watchlist action", VerifyActiveWatchlistAction);
test("the watchlist popup shows categorized streaming logos and attribution", VerifyStreamingPopup);
test("streaming metadata updates an active card after its API response arrives", VerifyStreamingUpdate);
test("missing streaming metadata shows an explicit watching-options box", VerifyMissingStreamingUpdate);
test("missing synopsis metadata shows explicit empty-state copy", VerifyMissingSynopsisUpdate);
test("movie cards show at most the top three actors", VerifyActorLimit);
test("TV cards present series-specific run, season, episode, and episode-runtime facts", VerifySeriesFacts);
test("actor metadata updates an already-rendered movie card", VerifyActorUpdate);
test("the active rater card renders a safe external trailer link", VerifyActiveTrailer);
test("watchlist cards receive their trailer link when metadata arrives", VerifyWatchlistTrailer);

function VerifyRecommendationSkeletons() {
  const html = RenderRecommendationSkeletons(8);
  assert.equal((html.match(/recommendation-skeleton/g) || []).length, 8);
  assert.equal((html.match(/recommendation-poster/g) || []).length, 8);
  assert.doesNotMatch(html, /skeleton-pills/);
  assert.match(html, /aria-hidden="true"/);
}

function VerifyRecommendationCard() {
  const item = BuildUnsafeRecommendation();
  const html = RenderRecommendationCard(item, 2);
  assert.match(html, /data-recommendation-details/);
  assert.match(html, /recommendation-tile-copy/);
  assert.match(html, /data-recommendation-watch/);
  assert.match(html, />Where to Watch</);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /Why this fits|data-recommendation-rating/);
}

function BuildUnsafeRecommendation() {
  return {
    title: "<script>",
    year: 2024,
    genres: [DramaGenre],
    ttId: "tt123",
    why: { tasteMatch: "A fit" }
  };
}

function VerifyRecommendationDetails() {
  const html = RenderRecommendationDetails({ ...Heat, addedAt: "2026-07-20T12:00:00.000Z", why: { tasteMatch: "A crime classic.", ratingEvidence: ["You rated Thief highly."] } });
  assert.match(html, new RegExp(`id="${RecommendationDetailsTitleId}"`));
  assert.match(html, /Why this fits/);
  assert.match(html, /You rated Thief highly/);
  assert.equal((html.match(/data-recommendation-rating=/g) || []).length, 10);
  assert.match(html, /data-recommendation-exclusion/);
}

function VerifyRecommendationRelativeDate() {
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  assert.equal(FormatRelativeDate("2026-07-23T11:42:00.000Z", now), "18 minutes ago");
  assert.equal(FormatRelativeDate("not-a-date", now), "Recently added");
}

function VerifyRecommendationSortMetadata() {
  const item = { ...Heat, addedAt: "2000-01-01T00:00:00.000Z", imdbRating: 8.3 };
  const added = RenderRecommendationCard(item, 0, RecommendationSortFields.addedAt);
  const rating = RenderRecommendationCard(item, 0, RecommendationSortFields.imdbRating);
  const year = RenderRecommendationCard(item, 0, RecommendationSortFields.year);
  const title = RenderRecommendationCard(item, 0, RecommendationSortFields.title);
  assert.match(added, /years ago/);
  assert.match(rating, /8\.3 IMDb/);
  assert.doesNotMatch(rating, /years ago/);
  assert.match(year, /recommendation-tile-sort-value">1995/);
  assert.match(title, /recommendation-tile-sort-value">Heat/);
}

function VerifyRecommendationEmpty() {
  assert.match(RenderRecommendationEmpty(), /watchlist is empty/);
}

function VerifyActiveWatchlistAction() {
  const movie = { ...Heat, imdbRating: 8.3, numVotes: 700000 };
  const active = RenderCard(movie, 0, {});
  const preview = RenderCard(movie, 1, {});
  assert.match(active, /data-add-active-to-wishlist/);
  assert.match(active, /Add to watchlist/);
  assert.doesNotMatch(preview, /data-add-active-to-wishlist/);
  assert.doesNotMatch(active, /1\s*\/\s*3/);
  assert.doesNotMatch(preview, /2\s*\/\s*3/);
  assert.match(active, new RegExp(`class="movie-id">${Heat.ttId}`));
  assert.doesNotMatch(active, new RegExp(`data-streaming-availability|${WhereToWatchLabel}`));
  assert.doesNotMatch(preview, /data-streaming-availability/);
}

function VerifyStreamingPopup() {
  const html = RenderRecommendationWatch(Heat, { streamingRequested: true, streamingAvailability: StreamingAvailability });
  assert.match(html, new RegExp(`id="${RecommendationDetailsTitleId}">Heat`));
  assert.match(html, new RegExp(WhereToWatchLabel));
  assert.match(html, /https:\/\/image\.tmdb\.org\/t\/p\/w92\/netflix\.jpg/);
  assert.match(html, />Stream</);
  assert.match(html, />Rent</);
  assert.match(html, /View all watching options/);
  assert.match(html, /JustWatch/);
  assert.match(html, new RegExp(`class="streaming-provider" role="img" aria-label="${NetflixName}" title="${NetflixName}"`));
  assert.match(html, new RegExp(`class="streaming-provider-name">${NetflixName}`));
  assert.match(RenderRecommendationWatch(Heat), /Checking streaming, rental, and purchase options/);
}

function VerifyStreamingUpdate() {
  const container = { hidden: true, innerHTML: "" };
  const card = { querySelector: (selector) => selector === StreamingSelector ? container : null };
  const metadata = {
    streamingAvailability: {
      country: StreamingCountry,
      providers: [{ type: "free", id: 1, name: "Freevee", logoPath: "" }]
    }
  };
  UpdateStreamingAvailability(card, metadata);
  assert.equal(container.hidden, false);
  assert.match(container.innerHTML, /Freevee/);
  assert.match(container.innerHTML, />Free</);
}

function VerifyMissingStreamingUpdate() {
  const container = { hidden: true, innerHTML: "" };
  const card = { querySelector: (selector) => selector === StreamingSelector ? container : null };
  UpdateStreamingAvailability(card, { streamingAvailability: null });
  assert.equal(container.hidden, false);
  assert.match(container.innerHTML, /class="streaming-empty"/);
  assert.match(container.innerHTML, new RegExp(MissingStreamingAvailability));
}

function VerifyMissingSynopsisUpdate() {
  const synopsis = { textContent: "Loading synopsis..." };
  const card = { querySelector: (selector) => selector === ".synopsis" ? synopsis : null };
  UpdateSynopsis(card, { synopsis: "" });
  assert.equal(synopsis.textContent, "No synopsis is available for this title.");
}

function VerifyActorLimit() {
  const html = RenderCard(Heat, 0, { actors: [...ActorNames, "Jon Voight"] });
  assert.match(html, /Starring/);
  assert.match(html, new RegExp(ActorSummary));
  assert.doesNotMatch(html, /Jon Voight/);
}

function VerifySeriesFacts() {
  const html = RenderCard(BuildSeries(), 0, BuildSeriesMetadata());
  assert.match(html, /class="series-details"/);
  assert.match(html, /2008–2013/);
  assert.match(html, /Ended/);
  assert.match(html, /5 seasons/);
  assert.match(html, /62 episodes/);
  assert.match(html, /48 min episodes/);
  assert.doesNotMatch(html, /class="pill">47 min/);
}

function BuildSeries() {
  return {
    ttId: "tt0903747",
    title: "Breaking Bad",
    year: 2008,
    endYear: 2013,
    mediaType: "tv",
    runtimeMinutes: 47,
    genres: [CrimeGenre, DramaGenre]
  };
}

function BuildSeriesMetadata() {
  return {
    seriesStatus: "Ended",
    seasonCount: 5,
    episodeCount: 62,
    episodeRuntimeMinutes: 48
  };
}

function VerifyActorUpdate() {
  const names = { textContent: "" };
  const cast = { hidden: true, querySelector: () => names };
  const card = { querySelector: (selector) => selector === ".movie-cast" ? cast : null };
  UpdateActors(card, { actors: ActorNames });
  assert.equal(cast.hidden, false);
  assert.equal(names.textContent, ActorSummary);
}

function VerifyActiveTrailer() {
  const html = RenderCard(Heat, 0, { trailerUrl: "https://www.youtube.com/watch?v=abc_123" });
  assert.match(html, /Watch trailer/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=abc_123"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
}

function VerifyWatchlistTrailer() {
  const attributes = new Map();
  const link = {
    hidden: true,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  };
  const card = { querySelector: (selector) => selector === "[data-trailer-link]" ? link : null };
  UpdateTrailerLink(card, { trailerUrl: TrailerUrl });
  assert.equal(link.hidden, false);
  assert.equal(attributes.get("href"), TrailerUrl);
}
