import assert from "node:assert/strict";
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

test("recommendation posters collapse globally and remember the browser preference", () => {
  const classes = new Set();
  const saved = new Map();
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value)
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.RecommendationPostersCollapsed = false;
    app.Elements = {
      recommendationGrid: { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } },
      toggleRecommendationPosters: {
        textContent: "",
        setAttribute(name, value) { this[name] = value; }
      }
    };

    app.ToggleRecommendationPosters();

    assert.equal(classes.has("posters-collapsed"), true);
    assert.equal(app.Elements.toggleRecommendationPosters.textContent, "Show posters");
    assert.equal(app.Elements.toggleRecommendationPosters["aria-pressed"], "true");
    assert.equal(app.ReadRecommendationPosterPreference(), true);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("recommendation watchlist renders and toggles collapsible three-movie rows", () => {
  const app = Object.create(RapidRaterApp.prototype);
  app.CollapsedRecommendationRows = new Set(["row-0"]);
  const items = [
    QueueItem("heat|1995", "tt0113277", "Heat", 1995),
    QueueItem("thief|1981", "tt0083190", "Thief", 1981),
    QueueItem("collateral|2004", "tt0369339", "Collateral", 2004),
    QueueItem("manhunter|1986", "tt0091474", "Manhunter", 1986)
  ];

  const html = app.BuildRecommendationRows(items);

  assert.equal((html.match(/data-recommendation-row-toggle/g) || []).length, 2);
  assert.match(html, /Picks 1–3/);
  assert.match(html, /Pick 4/);
  assert.match(html, /recommendation-row-titles">Heat \(1995\).*Thief \(1981\).*Collateral \(2004\)/);
  assert.match(html, /data-row-key="row-0" aria-expanded="false"/);
  assert.match(html, /recommendation-row-grid" hidden/);

  let rendered = 0;
  app.RenderRecommendationQueue = () => { rendered++; };
  app.ToggleRecommendationRow({ dataset: { rowKey: "row-0" } });
  assert.equal(app.CollapsedRecommendationRows.has("row-0"), false);
  assert.equal(rendered, 1);

  const shifted = app.BuildRecommendationRows(items.slice(1));
  assert.match(shifted, /recommendation-row-titles">Thief \(1981\).*Collateral \(2004\).*Manhunter \(1986\)/);
  assert.match(shifted, /data-row-key="row-0" aria-expanded="true"/);
});

test("collapsed recommendation rows persist per signed-in account", () => {
  const saved = new Map();
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value)
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.User = { id: "user-1" };
    app.CollapsedRecommendationRows = new Set(["row-0", "row-1"]);
    app.SaveCollapsedRecommendationRows();

    assert.deepEqual([...app.ReadCollapsedRecommendationRows()], ["row-0", "row-1"]);
    app.User = { id: "user-2" };
    assert.deepEqual([...app.ReadCollapsedRecommendationRows()], []);
  } finally {
    globalThis.localStorage = originalStorage;
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

function Recommendation(title, year) {
  return { title, year, genres: ["Crime"], why: { tasteMatch: "Match", ratingEvidence: ["Evidence"] } };
}

function Rating(title, year, rating) {
  return { title, year, genres: ["Drama"], rating };
}

function QueueItem(queueKey, ttId, title, year) {
  return { queueKey, ttId, title, year, genres: ["Crime"], why: { tasteMatch: "Match", ratingEvidence: [] } };
}
