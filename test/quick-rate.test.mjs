import assert from "node:assert/strict";
import test from "node:test";
import { QuickRateFeature, SearchQuickRateTitles } from "../src/app/features/quick-rate.js";

const ApplyCall = "apply";
const CommitCall = "commit";
const Heat1986Id = "tt0093164";
const Heat2013Id = "tt1648186";
const HeatId = "tt0113277";
const HeatTitle = "Heat";
const MementoId = "tt0209144";
const MementoTitle = "Memento";
const Movies = [
  { ttId: HeatId, title: HeatTitle, year: 1995, numVotes: 750000 },
  { ttId: Heat1986Id, title: HeatTitle, year: 1986, numVotes: 2500 },
  { ttId: Heat2013Id, title: "The Heat", year: 2013, numVotes: 190000 },
  { ttId: MementoId, title: MementoTitle, year: 2000, numVotes: 1400000 }
];

test("quick rate search ranks exact titles and can disambiguate by year", VerifyQuickRateRanking);
test("quick rate search accepts IMDb IDs and title URLs", VerifyQuickRateIdentifiers);
test("quick rate search requires a useful query and caps its output", VerifyQuickRateLimits);
test("quick rate commits once because the server transaction creates the IMDb job", VerifyQuickRateCommitOrder);

function VerifyQuickRateRanking() {
  assert.deepEqual(SearchQuickRateTitles(Movies, HeatTitle).map((movie) => movie.ttId), [HeatId, Heat1986Id, Heat2013Id]);
  assert.deepEqual(SearchQuickRateTitles(Movies, "Heat 1986").map((movie) => movie.ttId), [Heat1986Id]);
}

function VerifyQuickRateIdentifiers() {
  assert.deepEqual(SearchQuickRateTitles(Movies, MementoId).map((movie) => movie.title), [MementoTitle]);
  assert.deepEqual(SearchQuickRateTitles(Movies, `https://www.imdb.com/title/${HeatId}/`).map((movie) => movie.title), [HeatTitle]);
}

function VerifyQuickRateLimits() {
  assert.deepEqual(SearchQuickRateTitles(Movies, "h"), []);
  assert.equal(SearchQuickRateTitles(Movies, "heat", 2).length, 2);
}

async function VerifyQuickRateCommitOrder() {
  const scenario = BuildQuickRateCommitScenario();
  await scenario.feature.CommitQuickRating(Movies[0], 9);
  assert.deepEqual(scenario.calls.map((call) => call.kind), [CommitCall, ApplyCall]);
  assert.equal(scenario.calls[0].url, "/api/rater/quick-rating");
  assert.equal(scenario.calls[0].body.rating, 9);
}

function BuildQuickRateCommitScenario() {
  const feature = Object.create(QuickRateFeature.prototype);
  const calls = [];
  feature.State = { mediaType: "movie" };
  feature.NewActionId = () => "980f7ef2-b019-4ee1-bdec-9b88a0d9d27a";
  feature.RequestJson = async (url, method, body) => {
    calls.push({ kind: CommitCall, url, method, body });
    return { record: { ttId: body.titleId, rating: body.rating }, recommendations: [], queue: {} };
  };
  feature.ApplyQuickRatingCommit = (_payload, movie) => calls.push({ kind: ApplyCall, ttId: movie.ttId });
  return { feature, calls };
}
