import assert from "node:assert/strict";
import test from "node:test";
import { RenderCard, RenderRecommendationCard, RenderRecommendationEmpty, RenderRecommendationSkeletons, UpdateActors } from "../src/app/rendering.js";

test("recommendation loading renders eight cinematic placeholders", () => {
  const html = RenderRecommendationSkeletons(8);
  assert.equal((html.match(/recommendation-skeleton/g) || []).length, 8);
  assert.match(html, /skeleton-pills/);
  assert.match(html, /aria-hidden="true"/);
});

test("recommendation cards include visual ranking and escape generated text", () => {
  const html = RenderRecommendationCard({ title: "<script>", year: 2024, genres: ["Drama"], ttId: "tt123", why: { tasteMatch: "A fit" } }, 2);
  assert.match(html, /Pick 03/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("empty recommendation queue explains how to add picks", () => {
  assert.match(RenderRecommendationEmpty(), /watchlist is empty/);
});

test("only the active rating card offers the wishlist action", () => {
  const movie = { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime"], imdbRating: 8.3, numVotes: 700000 };
  const active = RenderCard(movie, 0, {}, 3);
  const preview = RenderCard(movie, 1, {}, 3);

  assert.match(active, /data-add-active-to-wishlist/);
  assert.match(active, /Add to wishlist/);
  assert.doesNotMatch(preview, /data-add-active-to-wishlist/);
});

test("movie cards show at most the top three actors", () => {
  const movie = { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime"] };
  const html = RenderCard(movie, 0, { actors: ["Al Pacino", "Robert De Niro", "Val Kilmer", "Jon Voight"] }, 3);

  assert.match(html, /Starring/);
  assert.match(html, /Al Pacino · Robert De Niro · Val Kilmer/);
  assert.doesNotMatch(html, /Jon Voight/);
});

test("actor metadata updates an already-rendered movie card", () => {
  const names = { textContent: "" };
  const cast = { hidden: true, querySelector: () => names };
  const card = { querySelector: (selector) => selector === ".movie-cast" ? cast : null };

  UpdateActors(card, { actors: ["Al Pacino", "Robert De Niro", "Val Kilmer"] });

  assert.equal(cast.hidden, false);
  assert.equal(names.textContent, "Al Pacino · Robert De Niro · Val Kilmer");
});
