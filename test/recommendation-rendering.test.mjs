import assert from "node:assert/strict";
import test from "node:test";
import { RenderCard, RenderRecommendationCard, RenderRecommendationEmpty, RenderRecommendationSkeletons, UpdateActors, UpdateStreamingAvailability, UpdateTrailerLink } from "../src/app/rendering.js";

const HeatData = { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime"] };
const Heat = Object.freeze(HeatData);
const TrailerUrl = "https://www.youtube.com/watch?v=trailer";
const StreamingAvailabilityData = {
  country: "US",
  watchUrl: "https://www.themoviedb.org/movie/949/watch?locale=US",
  providers: [
    { type: "subscription", id: 8, name: "Netflix", logoPath: "/netflix.jpg" },
    { type: "rent", id: 2, name: "Apple TV", logoPath: "/apple.jpg" }
  ]
};
const StreamingAvailability = Object.freeze(StreamingAvailabilityData);

test("recommendation loading renders eight cinematic placeholders", VerifyRecommendationSkeletons);
test("recommendation cards include visual ranking and escape generated text", VerifyRecommendationCard);
test("empty recommendation queue explains how to add picks", VerifyRecommendationEmpty);
test("only the active rating card offers the watchlist action", VerifyActiveWatchlistAction);
test("the active card shows categorized streaming logos and attribution below its synopsis", VerifyStreamingCard);
test("streaming metadata updates an active card after its API response arrives", VerifyStreamingUpdate);
test("movie cards show at most the top three actors", VerifyActorLimit);
test("TV cards present series-specific run, season, episode, and episode-runtime facts", VerifySeriesFacts);
test("actor metadata updates an already-rendered movie card", VerifyActorUpdate);
test("the active rater card renders a safe external trailer link", VerifyActiveTrailer);
test("watchlist cards receive their trailer link when metadata arrives", VerifyWatchlistTrailer);

function VerifyRecommendationSkeletons() {
  const html = RenderRecommendationSkeletons(8);
  assert.equal((html.match(/recommendation-skeleton/g) || []).length, 8);
  assert.match(html, /skeleton-pills/);
  assert.match(html, /aria-hidden="true"/);
}

function VerifyRecommendationCard() {
  const html = RenderRecommendationCard({ title: "<script>", year: 2024, genres: ["Drama"], ttId: "tt123", why: { tasteMatch: "A fit" } }, 2);
  assert.match(html, /Pick 03/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
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
  assert.match(active, /data-streaming-availability/);
  assert.doesNotMatch(preview, /data-streaming-availability/);
}

function VerifyStreamingCard() {
  const html = RenderCard(Heat, 0, { synopsis: "A crime saga.", streamingAvailability: StreamingAvailability });
  assert.ok(html.indexOf("A crime saga.") < html.indexOf("Where to watch"));
  assert.match(html, /https:\/\/image\.tmdb\.org\/t\/p\/w92\/netflix\.jpg/);
  assert.match(html, />Stream</);
  assert.match(html, />Rent</);
  assert.match(html, /View all watching options/);
  assert.match(html, /JustWatch/);
  assert.match(html, /class="streaming-provider" role="img" aria-label="Netflix" title="Netflix"/);
  assert.match(html, /class="streaming-provider-name">Netflix/);
}

function VerifyStreamingUpdate() {
  const container = { hidden: true, innerHTML: "" };
  const card = { querySelector: (selector) => selector === "[data-streaming-availability]" ? container : null };
  const metadata = {
    streamingAvailability: {
      country: "US",
      providers: [{ type: "free", id: 1, name: "Freevee", logoPath: "" }]
    }
  };
  UpdateStreamingAvailability(card, metadata);
  assert.equal(container.hidden, false);
  assert.match(container.innerHTML, /Freevee/);
  assert.match(container.innerHTML, />Free</);
}

function VerifyActorLimit() {
  const html = RenderCard(Heat, 0, { actors: ["Al Pacino", "Robert De Niro", "Val Kilmer", "Jon Voight"] });
  assert.match(html, /Starring/);
  assert.match(html, /Al Pacino · Robert De Niro · Val Kilmer/);
  assert.doesNotMatch(html, /Jon Voight/);
}

function VerifySeriesFacts() {
  const show = { ttId: "tt0903747", title: "Breaking Bad", year: 2008, endYear: 2013, mediaType: "tv", runtimeMinutes: 47, genres: ["Crime", "Drama"] };
  const html = RenderCard(show, 0, { seriesStatus: "Ended", seasonCount: 5, episodeCount: 62, episodeRuntimeMinutes: 48 });
  assert.match(html, /class="series-details"/);
  assert.match(html, /2008–2013/);
  assert.match(html, /Ended/);
  assert.match(html, /5 seasons/);
  assert.match(html, /62 episodes/);
  assert.match(html, /48 min episodes/);
  assert.doesNotMatch(html, /class="pill">47 min/);
}

function VerifyActorUpdate() {
  const names = { textContent: "" };
  const cast = { hidden: true, querySelector: () => names };
  const card = { querySelector: (selector) => selector === ".movie-cast" ? cast : null };
  UpdateActors(card, { actors: ["Al Pacino", "Robert De Niro", "Val Kilmer"] });
  assert.equal(cast.hidden, false);
  assert.equal(names.textContent, "Al Pacino · Robert De Niro · Val Kilmer");
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
