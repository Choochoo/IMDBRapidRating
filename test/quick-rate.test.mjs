import assert from "node:assert/strict";
import test from "node:test";
import { QuickRateFeature, SearchQuickRateTitles } from "../src/app/features/quick-rate.js";

const Movies = [
  { ttId: "tt0113277", title: "Heat", year: 1995, numVotes: 750000 },
  { ttId: "tt0093164", title: "Heat", year: 1986, numVotes: 2500 },
  { ttId: "tt1648186", title: "The Heat", year: 2013, numVotes: 190000 },
  { ttId: "tt0209144", title: "Memento", year: 2000, numVotes: 1400000 }
];

test("quick rate search ranks exact titles and can disambiguate by year", () => {
  assert.deepEqual(SearchQuickRateTitles(Movies, "Heat").map((movie) => movie.ttId), ["tt0113277", "tt0093164", "tt1648186"]);
  assert.deepEqual(SearchQuickRateTitles(Movies, "Heat 1986").map((movie) => movie.ttId), ["tt0093164"]);
});

test("quick rate search accepts IMDb IDs and title URLs", () => {
  assert.deepEqual(SearchQuickRateTitles(Movies, "tt0209144").map((movie) => movie.title), ["Memento"]);
  assert.deepEqual(SearchQuickRateTitles(Movies, "https://www.imdb.com/title/tt0113277/").map((movie) => movie.title), ["Heat"]);
});

test("quick rate search requires a useful query and caps its output", () => {
  assert.deepEqual(SearchQuickRateTitles(Movies, "h"), []);
  assert.equal(SearchQuickRateTitles(Movies, "heat", 2).length, 2);
});

test("quick rate commits once because the server transaction creates the IMDb job", VerifyQuickRateCommitOrder);

async function VerifyQuickRateCommitOrder() {
  const scenario = BuildQuickRateCommitScenario();
  await scenario.feature.CommitQuickRating(Movies[0], 9);
  assert.deepEqual(scenario.calls.map((call) => call.kind), ["commit", "apply"]);
  assert.equal(scenario.calls[0].url, "/api/rater/quick-rating");
  assert.equal(scenario.calls[0].body.rating, 9);
}

function BuildQuickRateCommitScenario() {
  const feature = Object.create(QuickRateFeature.prototype);
  const calls = [];
  feature.State = { mediaType: "movie" };
  feature.NewActionId = () => "980f7ef2-b019-4ee1-bdec-9b88a0d9d27a";
  feature.RequestJson = async (url, method, body) => {
    calls.push({ kind: "commit", url, method, body });
    return { record: { ttId: body.titleId, rating: body.rating }, recommendations: [], queue: {} };
  };
  feature.ApplyQuickRatingCommit = (_payload, movie) => calls.push({ kind: "apply", ttId: movie.ttId });
  return { feature, calls };
}
