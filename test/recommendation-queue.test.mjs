import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GenerateAiRecommendations, ReadOutputTokenLimit, ReadRecommendationCount } from "../server/ai-recommendations.mjs";
import { NormalizeRecommendationQueue, RecommendationKey, SameRecommendation } from "../server/recommendation-queue.mjs";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";

test("recommendation counts accept whole numbers from 1 through 99", () => {
  assert.equal(ReadRecommendationCount(1), 1);
  assert.equal(ReadRecommendationCount("9"), 9);
  assert.equal(ReadRecommendationCount(99), 99);
  assert.equal(ReadRecommendationCount(0), 0);
  assert.equal(ReadRecommendationCount(100), 0);
  assert.equal(ReadRecommendationCount(4.5), 0);
  assert.ok(ReadOutputTokenLimit(99) > ReadOutputTokenLimit(9));
});

test("queue normalization rejects duplicate IMDb IDs and duplicate title-year pairs", () => {
  const queue = NormalizeRecommendationQueue([
    { ttId: "tt0113277", title: "Heat", year: 1995 },
    { ttId: "tt0113277", title: "HEAT", year: 1995 },
    { title: "Heat", year: 1995 },
    { ttId: "tt0083190", title: "Thief", year: 1981 }
  ]);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].queueKey, "heat|1995");
  assert.equal(RecommendationKey({ title: "The  Thing", year: 1982 }), "the thing|1982");
  assert.equal(SameRecommendation({ ttId: "tt1", title: "A", year: 2000 }, { ttId: "tt1", title: "B", year: 2001 }), true);
  assert.equal(SameRecommendation({ title: "Alien" }, { title: "Alien", year: 1979 }), true);
});

test("browser recommendation count defaults to 9 and rejects values above 99", () => {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { recommendationCount: { value: "9" } };
  assert.equal(app.ReadRecommendationCount(), 9);
  app.Elements.recommendationCount.value = "99";
  assert.equal(app.ReadRecommendationCount(), 99);
  app.Elements.recommendationCount.value = "100";
  assert.throws(() => app.ReadRecommendationCount(), /1 to 99/);
});

test("movie picks can use TV taste signals without changing movie exclusions or rated-title blocking", async () => {
  const movie = { ttId: "tt0000001", title: "Rated Movie", year: 2001, genres: ["Drama"] };
  const tvRatings = Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
    const number = index + 2;
    const ttId = `tt000000${number}`;
    return [ttId, ClientRating(ttId, `TV Show ${number}`, 2010 + index, 10 - index, "tv")];
  }));
  const tvTitles = Object.values(tvRatings).map((rating) => ({ ...rating, genres: ["Mystery"] }));
  const app = Object.create(RapidRaterApp.prototype);
  app.State = {
    mediaType: "movie",
    recommendationBasis: { source: "other", updatedAt: "2026-07-19T12:00:00.000Z" },
    ratings: { [movie.ttId]: ClientRating(movie.ttId, movie.title, movie.year, 8, "movie") },
    movieById: new Map([[movie.ttId, movie]]),
    recommendationExclusions: [{ title: "Blocked Movie", year: 2002 }]
  };
  app.AccountPayload = { media: { movie: {}, tv: { ratings: tvRatings } } };
  app.EnsureCatalog = async (mediaType) => {
    assert.equal(mediaType, "tv");
    return { movieById: new Map(tvTitles.map((title) => [title.ttId, title])) };
  };

  const request = await app.BuildRecommendationRequest(7);

  assert.equal(request.count, 7);
  assert.equal(request.mediaType, "movie");
  assert.equal(request.profile.tasteBasis, "other");
  assert.equal(request.profile.ratings.length, 5);
  assert.ok(request.profile.ratings.every((rating) => rating.sourceMediaType === "tv"));
  assert.deepEqual(request.profile.ratedTargets, [{ title: "Rated Movie", year: 2001 }]);
  assert.deepEqual(request.profile.exclusions, [{ title: "Blocked Movie", year: 2002 }]);
});

test("browser queue removal matches by IMDb ID or normalized title and year", () => {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = {
    recommendationQueue: [
      { ttId: "tt0113277", title: "Heat", year: 1995 },
      { ttId: "tt0083190", title: "Thief", year: 1981 }
    ],
    ai: { configured: true }
  };
  app.Elements = { recommendationStatus: { textContent: "" } };
  app.RenderRecommendationQueue = () => {};
  app.ReadAiModelLabel = () => "test model";

  assert.equal(app.RemoveRecommendationFromQueue({ title: "HEAT", year: 1995 }), true);
  assert.deepEqual(app.State.recommendationQueue.map((item) => item.ttId), ["tt0083190"]);
});

test("browser watchlist exposes only recommendations inside the active filters", () => {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = {
    filters: { includedGenres: ["Documentary"], minYear: 2010, includedOriginalLanguages: ["en"] },
    recommendationQueue: [
      { title: "Free Solo", year: 2018, genres: ["Documentary"], originalLanguage: "en" },
      { title: "Heat", year: 1995, genres: ["Crime"], originalLanguage: "en" },
      { title: "The Rescue", year: 2021, genres: ["Documentary"], originalLanguage: "th" }
    ]
  };
  app.Elements = { recommendationSort: { value: "addedAt" } };
  app.RecommendationSortDescending = true;
  assert.deepEqual(app.ReadVisibleRecommendations().map((item) => item.title), ["Free Solo"]);
});

test("rating queue rebuild excludes movies already saved to the watchlist", () => {
  const app = Object.create(RapidRaterApp.prototype);
  const movies = [
    { ttId: "tt0113277", title: "Heat" },
    { ttId: "tt0083190", title: "Thief" },
    { ttId: "tt0369339", title: "Collateral" }
  ];
  app.State = {
    movies,
    movieById: new Map(movies.map((movie) => [movie.ttId, movie])),
    ratings: { tt0083190: { status: "rated" } },
    recommendationQueue: [{ ttId: "tt0113277", title: "Heat", year: 1995 }],
    savedQueueIds: ["tt0113277", "tt0083190", "tt0369339"]
  };

  app.RebuildQueue();

  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), ["tt0369339"]);
});

test("active rating movie moves into the saved watchlist", async () => {
  const app = Object.create(RapidRaterApp.prototype);
  const heat = { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime", "Drama"] };
  const thief = { ttId: "tt0083190", title: "Thief", year: 1981, genres: ["Crime"] };
  app.State = {
    movies: [heat, thief],
    movieById: new Map([[heat.ttId, heat], [thief.ttId, thief]]),
    queue: [heat, thief],
    savedQueueIds: [heat.ttId, thief.ttId],
    queueRevision: 7,
    queuePoolVersion: "pool-v1",
    queueReady: true,
    ratings: {},
    recommendationQueue: [],
    locked: false
  };
  app.NewActionId = () => "5d226a99-19c4-463a-9f0f-cbe9d717a641";
  app.RequestJson = async (url, method, body) => {
    assert.equal(url, "/api/rater/decision");
    assert.equal(method, "PUT");
    assert.equal(body.expectedRevision, 7);
    assert.equal(body.kind, "wishlist");
    assert.equal(body.titleId, heat.ttId);
    return {
      ok: true,
      recommendations: [{ ...heat, queueKey: "heat|1995" }],
      queue: { revision: 8, poolVersion: "pool-v1", queueIds: [thief.ttId] }
    };
  };
  let persisted = 0;
  let rendered = 0;
  let recommendationRendered = 0;
  let toast = "";
  app.PersistStateNow = () => { persisted++; };
  app.Render = () => { rendered++; };
  app.RenderRecommendationQueue = () => { recommendationRendered++; };
  app.UpdateRecommendationStatus = () => {};
  app.ShowToast = (value) => { toast = value; };
  const classes = new Set();
  const button = {
    disabled: false,
    innerHTML: "<span>☆</span> Add to watchlist",
    textContent: "",
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    }
  };

  assert.equal(await app.AddActiveMovieToWishlist(button), true);
  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), ["tt0083190"]);
  assert.deepEqual(app.State.recommendationQueue.map((movie) => movie.ttId), ["tt0113277"]);
  assert.equal(app.State.locked, false);
  assert.equal(persisted, 0);
  assert.equal(rendered, 1);
  assert.equal(recommendationRendered, 1);
  assert.match(toast, /added to your watchlist/);
  assert.equal(button.disabled, false);
  assert.equal(classes.has("saving"), false);
});

test("recommendation watchlist renders one continuous poster grid", VerifyRecommendationGrid);
test("recommendation watchlist sorts client-side with stable title ties", VerifyRecommendationSorting);
test("recommendation sort controls choose sensible directions and rerender", VerifyRecommendationSortControls);
test("recommendation details open from a tile and restore focus when closed", VerifyRecommendationDetailsInteraction);

function VerifyRecommendationGrid() {
  const app = Object.create(RapidRaterApp.prototype);
  const items = [
    QueueItem("heat|1995", "tt0113277", "Heat", 1995),
    QueueItem("thief|1981", "tt0083190", "Thief", 1981),
    QueueItem("collateral|2004", "tt0369339", "Collateral", 2004),
    QueueItem("manhunter|1986", "tt0091474", "Manhunter", 1986)
  ];

  const html = app.BuildRecommendationCards(items);

  assert.equal((html.match(/data-recommendation-details/g) || []).length, 4);
  assert.equal((html.match(/recommendation-poster/g) || []).length, 4);
  assert.doesNotMatch(html, /recommendation-row|data-row-key/);
  assert.ok(html.indexOf("Heat") < html.indexOf("Manhunter"));
}

function VerifyRecommendationSorting() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { recommendationSort: { value: "addedAt" } };
  app.RecommendationSortDescending = true;
  const items = [
    { ...QueueItem("heat|1995", "tt0113277", "Heat", 1995), addedAt: "2026-07-20T12:00:00.000Z" },
    { ...QueueItem("thief|1981", "tt0083190", "Thief", 1981), addedAt: "2026-07-22T12:00:00.000Z" },
    { ...QueueItem("alien|1979", "tt0078748", "Alien", 1979), addedAt: "2026-07-22T12:00:00.000Z" }
  ];

  assert.deepEqual(app.SortRecommendations(items).map((item) => item.title), ["Alien", "Thief", "Heat"]);
  app.Elements.recommendationSort.value = "title";
  app.RecommendationSortDescending = false;
  assert.deepEqual(app.SortRecommendations(items).map((item) => item.title), ["Alien", "Heat", "Thief"]);
}

function VerifyRecommendationSortControls() {
  const app = Object.create(RapidRaterApp.prototype);
  const attributes = new Map();
  app.Elements = BuildRecommendationSortElements(attributes);
  let rendered = 0;
  app.RenderRecommendationQueue = () => { rendered++; };
  app.HandleRecommendationSortChange();
  assert.equal(app.RecommendationSortDescending, false);
  assert.equal(app.Elements.recommendationSortDirection.textContent, "↑");
  app.ToggleRecommendationSortDirection();
  assert.equal(app.RecommendationSortDescending, true);
  assert.equal(attributes.get("aria-label"), "Sort descending");
  assert.equal(rendered, 2);
}

function VerifyRecommendationDetailsInteraction() {
  const app = Object.create(RapidRaterApp.prototype);
  const item = QueueItem("heat|1995", "tt0113277", "Heat", 1995);
  let focused = 0;
  const button = BuildRecommendationDetailsButton(item, () => { focused++; });
  app.State = { recommendationQueue: [item] };
  app.Elements = BuildRecommendationDetailsElements(() => { focused++; });
  app.EnrichTitleMetadata = () => {};
  app.ShowRecommendationDetails(button);
  AssertRecommendationDetailsOpen(app);
  app.HideRecommendationDetails();
  AssertRecommendationDetailsClosed(app, focused);
}

function BuildRecommendationSortElements(attributes) {
  return {
    recommendationSort: { value: "title" },
    recommendationSortDirection: {
      textContent: "",
      title: "",
      setAttribute: (name, value) => attributes.set(name, value)
    }
  };
}

function BuildRecommendationDetailsButton(item, focus) {
  const container = { dataset: { ttid: item.ttId, title: item.title, year: String(item.year) } };
  return { closest: () => container, focus };
}

function BuildRecommendationDetailsElements(focus) {
  return {
    recommendationDetails: { hidden: true },
    recommendationDetailsContent: { innerHTML: "" },
    recommendationDetailsClose: { focus }
  };
}

function AssertRecommendationDetailsOpen(app) {
  assert.equal(app.Elements.recommendationDetails.hidden, false);
  assert.match(app.Elements.recommendationDetailsContent.innerHTML, /Why this fits/);
}

function AssertRecommendationDetailsClosed(app, focused) {
  assert.equal(app.Elements.recommendationDetails.hidden, true);
  assert.equal(app.Elements.recommendationDetailsContent.innerHTML, "");
  assert.equal(focused, 2);
}

test("AI Picks hides both rating bars and removes the mobile bottom-bar layout state", () => {
  const classes = new Set(["rater-active"]);
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        toggle(name, enabled) {
          if (enabled)
            classes.add(name);
          else
            classes.delete(name);
        }
      }
    }
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.State = { activeView: "rater" };
    app.Elements = ViewElements();
    app.UpdateRecommendationBasisControl = () => {};
    app.UpdateRecommendationStatus = () => {};
    app.UpdateSyncView = () => {};

    app.ShowView("ai");

    assert.equal(app.Elements.recommendationView.hidden, false);
    assert.equal(app.Elements.ratingFooter.hidden, true);
    assert.equal(app.Elements.mobileRatingBar.hidden, true);
    assert.equal(classes.has("rater-active"), false);
    assert.equal(classes.has("ai-active"), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("AI generation sends the saved queue and refills after server-side duplicate filtering", async () => {
  const calls = [];
  const responses = [
    {
      summary: "First pass",
      recommendations: [Recommendation("Heat", 1995), Recommendation("Thief", 1981)]
    },
    {
      summary: "Refill",
      recommendations: [Recommendation("Thief", 1981), Recommendation("Collateral", 2004)]
    }
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify(responses.shift()) }) };
  };
  try {
    const result = await GenerateAiRecommendations(process.cwd(), {
      apiKey: "test-key",
      model: "gpt-test",
      count: 2,
      queue: [{ ttId: "tt0113277", title: "Heat", year: 1995 }],
      profile: {
        ratings: [
          Rating("The Godfather", 1972, 10),
          Rating("Goodfellas", 1990, 9),
          Rating("Jaws", 1975, 8),
          Rating("Arrival", 2016, 8),
          Rating("Memento", 2000, 9)
        ],
        exclusions: [{ title: "Alien", year: 1979 }]
      }
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.payload.recommendations.map((item) => item.title), ["Thief", "Collateral"]);
    assert.equal(calls.length, 2);
    const firstProfile = JSON.parse(calls[0].input[1].content);
    assert.deepEqual(firstProfile.queue, [{ title: "Heat", year: 1995 }]);
    assert.deepEqual(firstProfile.exclusions, [{ title: "Alien", year: 1979 }]);
    assert.equal(firstProfile.ratings.length, 5);
    assert.equal(calls[0].text.format.schema.properties.recommendations.minItems, 2);
    assert.equal(calls[1].text.format.schema.properties.recommendations.minItems, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI generation sends active filters and rejects catalog matches outside them", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "rapid-rater-ai-filters-"));
  await mkdir(path.join(rootPath, "data"));
  await writeFile(path.join(rootPath, "data", "movies.json"), JSON.stringify({
    movies: [
      { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime"], imdbRating: 8.3, runtimeMinutes: 170, originCountries: ["US"], originalLanguage: "en" },
      { ttId: "tt6751668", title: "Parasite", year: 2019, genres: ["Crime", "Drama"], imdbRating: 8.5, runtimeMinutes: 132, originCountries: ["KR"], originalLanguage: "ko" }
    ]
  }));
  const calls = [];
  const responses = [Recommendation("Heat", 1995), Recommendation("Parasite", 2019)];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ summary: "Filtered", recommendations: [responses.shift()] }) })
    };
  };
  try {
    const result = await GenerateAiRecommendations(rootPath, {
      apiKey: "test-key",
      model: "gpt-test",
      count: 1,
      filters: { minYear: 2000, includedGenres: ["Drama"], documentaryMode: "exclude", minImdbRating: 8, maxRuntimeMinutes: 150, includedOriginalLanguages: ["ko"], excludedOriginCountries: ["US"], updatedAt: "2026-07-19T12:00:00.000Z" },
      profile: { ratings: [
        Rating("The Godfather", 1972, 10),
        Rating("Goodfellas", 1990, 9),
        Rating("Jaws", 1975, 8),
        Rating("Arrival", 2016, 8),
        Rating("Memento", 2000, 9)
      ] }
    });

    assert.deepEqual(result.payload.recommendations.map((item) => item.title), ["Parasite"]);
    assert.equal(calls.length, 2);
    const profile = JSON.parse(calls[0].input[1].content);
    assert.equal(profile.filters.minYear, 2000);
    assert.deepEqual(profile.filters.includedGenres, ["Drama"]);
    assert.equal(profile.filters.documentaryMode, "exclude");
    assert.equal(profile.filters.minImdbRating, 8);
    assert.equal(profile.filters.maxRuntimeMinutes, 150);
    assert.deepEqual(profile.filters.includedOriginalLanguages, ["ko"]);
    assert.deepEqual(profile.filters.excludedOriginCountries, ["US"]);
    assert.equal(profile.filters.updatedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("cross-media taste titles are evidence, while target ratings remain blocked", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "rapid-rater-ai-cross-media-"));
  await mkdir(path.join(rootPath, "data"));
  await writeFile(path.join(rootPath, "data", "movies.json"), JSON.stringify({
    movies: [
      { ttId: "tt0000010", title: "Already Rated", year: 2001 },
      { ttId: "tt0000011", title: "Shared Taste", year: 2020 }
    ]
  }));
  const calls = [];
  const responses = [Recommendation("Already Rated", 2001), Recommendation("Shared Taste", 2020)];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ summary: "Cross-media", recommendations: [responses.shift()] }) })
    };
  };
  try {
    const result = await GenerateAiRecommendations(rootPath, {
      apiKey: "test-key",
      model: "gpt-test",
      count: 1,
      mediaType: "movie",
      targetRatings: [{ ...Rating("Already Rated", 2001, 8), mediaType: "movie" }],
      targetExclusions: [{ title: "Movie Exclusion", year: 2002 }],
      profile: {
        tasteBasis: "other",
        ratings: [
          { ...Rating("Shared Taste", 2020, 10), sourceMediaType: "tv" },
          { ...Rating("Series Two", 2019, 9), sourceMediaType: "tv" },
          { ...Rating("Series Three", 2018, 8), sourceMediaType: "tv" },
          { ...Rating("Series Four", 2017, 8), sourceMediaType: "tv" },
          { ...Rating("Series Five", 2016, 7), sourceMediaType: "tv" }
        ],
        ratedTargets: []
      }
    });

    assert.deepEqual(result.payload.recommendations.map((item) => item.title), ["Shared Taste"]);
    assert.equal(calls.length, 2);
    const profile = JSON.parse(calls[0].input[1].content);
    assert.equal(profile.mediaType, "movie");
    assert.equal(profile.tasteBasis, "other");
    assert.equal(profile.ratings[0].sourceMediaType, "tv");
    assert.deepEqual(profile.ratedTargets, [{ title: "Already Rated", year: 2001 }]);
    assert.deepEqual(profile.exclusions, [{ title: "Movie Exclusion", year: 2002 }]);
    assert.match(calls[0].input[0].content, /return only movies/i);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(rootPath, { recursive: true, force: true });
  }
});

function Recommendation(title, year) {
  return { title, year, genres: ["Crime"], why: { tasteMatch: "Match", ratingEvidence: ["Evidence"] } };
}

function Rating(title, year, rating) {
  return { title, year, genres: ["Drama"], rating };
}

function ClientRating(ttId, title, year, rating, mediaType) {
  return { ttId, title, year, rating, mediaType, status: "rated", at: `${year}-01-01T00:00:00.000Z` };
}

function QueueItem(queueKey, ttId, title, year) {
  return { queueKey, ttId, title, year, genres: ["Crime"], why: { tasteMatch: "Match", ratingEvidence: [] } };
}

function ViewElements() {
  const ClassList = () => ({ toggle() {}, remove() {} });
  return {
    raterView: { hidden: false },
    recommendationView: { hidden: true },
    syncView: { hidden: true },
    ratingFooter: { hidden: false },
    mobileRatingBar: { hidden: false },
    tabRater: { classList: ClassList() },
    tabAi: { classList: ClassList() },
    tabSync: { classList: ClassList() }
  };
}
