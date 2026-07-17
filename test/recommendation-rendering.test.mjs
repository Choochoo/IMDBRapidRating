import assert from "node:assert/strict";
import test from "node:test";
import { RenderRecommendationCard, RenderRecommendationEmpty, RenderRecommendationSkeletons } from "../src/app/rendering.js";

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
