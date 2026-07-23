import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GenerateAiRecommendations, ReadOutputTokenLimit, ReadRecommendationCount } from "../server/ai-recommendations.mjs";
import { NormalizeRecommendationQueue, RecommendationKey, SameRecommendation } from "../server/recommendation-queue.mjs";
import { RecommendationSortFields } from "../src/app/app-constants.js";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";

const HeatId = "tt0113277";
const HeatTitle = "Heat";
const HeatQueueKey = "heat|1995";
const ThiefId = "tt0083190";
const ThiefTitle = "Thief";
const ThiefQueueKey = "thief|1981";
const CollateralId = "tt0369339";
const CollateralTitle = "Collateral";
const TestAiBaseUrl = "https://ai.example.test/v1";
const TestModel = "test-model";
const AlienTitle = "Alien";
const FilterGenre = "Drama";
const CrimeGenre = "Crime";
const DocumentaryGenre = "Documentary";
const EnglishLanguage = "en";
const RatedMovieTitle = "Rated Movie";
const BlockedMovieTitle = "Blocked Movie";
const FreeSoloTitle = "Free Solo";
const ParasiteTitle = "Parasite";
const AlreadyRatedTitle = "Already Rated";
const SharedTasteTitle = "Shared Taste";
const KoreanLanguage = "ko";
const UsCountry = "US";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const OtherTasteBasis = "other";
const AddedSortField = "addedAt";
const TitleSortField = "title";
const RatedStatus = "rated";
const PoolVersion = "pool-v1";
const ActiveRaterClass = "rater-active";
const NoOp = () => undefined;
const AddedAtTimestamp = "2026-07-22T12:00:00.000Z";
const DocumentaryExcludeMode = "exclude";
const DataDirectory = "data";
const FilterUpdatedAt = "2026-07-19T12:00:00.000Z";
const ManhunterId = "tt0091474";
const ManhunterQueueKey = "manhunter|1986";
const ManhunterTitle = "Manhunter";
const MatchReason = "Match";
const MovieExclusionTitle = "Movie Exclusion";
const MinimumItemsField = "minItems";
const SameRecommendationId = "tt1";
const StoredCount = "9";

test("recommendation counts accept whole numbers from 1 through 99", VerifyRecommendationCounts);
test("queue normalization rejects duplicate IMDb IDs and duplicate title-year pairs", VerifyQueueNormalization);
test("browser recommendation count defaults to 9 and rejects values above 99", VerifyBrowserRecommendationCount);

function VerifyRecommendationCounts() {
  assert.equal(ReadRecommendationCount(1), 1);
  assert.equal(ReadRecommendationCount(StoredCount), 9);
  assert.equal(ReadRecommendationCount(99), 99);
  assert.equal(ReadRecommendationCount(0), 0);
  assert.equal(ReadRecommendationCount(100), 0);
  assert.equal(ReadRecommendationCount(4.5), 0);
  assert.ok(ReadOutputTokenLimit(99) > ReadOutputTokenLimit(9));
}

function VerifyQueueNormalization() {
  const candidates = [
    { ttId: HeatId, title: HeatTitle, year: 1995 },
    { ttId: HeatId, title: HeatTitle.toUpperCase(), year: 1995 },
    { title: HeatTitle, year: 1995 },
    { ttId: ThiefId, title: ThiefTitle, year: 1981 }
  ];
  const queue = NormalizeRecommendationQueue(candidates);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].queueKey, HeatQueueKey);
  assert.equal(RecommendationKey({ title: "The  Thing", year: 1982 }), "the thing|1982");
  assert.equal(SameRecommendation({ ttId: SameRecommendationId, title: "A", year: 2000 }, { ttId: SameRecommendationId, title: "B", year: 2001 }), true);
  assert.equal(SameRecommendation({ title: AlienTitle }, { title: AlienTitle, year: 1979 }), true);
}

function VerifyBrowserRecommendationCount() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { recommendationCount: { value: StoredCount } };
  assert.equal(app.ReadRecommendationCount(), 9);
  app.Elements.recommendationCount.value = "99";
  assert.equal(app.ReadRecommendationCount(), 99);
  app.Elements.recommendationCount.value = "100";
  assert.throws(() => app.ReadRecommendationCount(), /1 to 99/);
}

test("movie picks can use TV taste signals without changing movie exclusions or rated-title blocking", VerifyCrossMediaTaste);
test("browser queue removal matches by IMDb ID or normalized title and year", VerifyBrowserQueueRemoval);
test("rating queue rebuild excludes movies already saved to the watchlist", VerifyRatingQueueRebuild);
test("active rating movie moves into the saved watchlist", VerifyActiveWishlist);

async function VerifyCrossMediaTaste() {
  const fixture = BuildCrossMediaFixture();
  const app = BuildCrossMediaApp(fixture);
  const request = await app.BuildRecommendationRequest(7);
  AssertCrossMediaRequest(request);
}

function BuildCrossMediaFixture() {
  const movie = { ttId: "tt0000001", title: RatedMovieTitle, year: 2001, genres: [FilterGenre] };
  const tvRatings = Object.fromEntries(Array.from({ length: 5 }, BuildTvRating));
  const tvTitles = Object.values(tvRatings).map((rating) => ({ ...rating, genres: ["Mystery"] }));
  return { movie, tvRatings, tvTitles };
}

function BuildTvRating(_value, index) {
  const number = index + 2;
  const ttId = `tt000000${number}`;
  return [ttId, ClientRating(ttId, `TV Show ${number}`, 2010 + index, 10 - index, TvMediaType)];
}

function BuildCrossMediaApp({ movie, tvRatings, tvTitles }) {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = BuildCrossMediaState(movie);
  app.AccountPayload = { media: { movie: {}, tv: { ratings: tvRatings } } };
  app.EnsureCatalog = async (mediaType) => {
    assert.equal(mediaType, TvMediaType);
    return { movieById: new Map(tvTitles.map((title) => [title.ttId, title])) };
  };
  return app;
}

function BuildCrossMediaState(movie) {
  return {
    mediaType: MovieMediaType,
    recommendationBasis: { source: OtherTasteBasis, updatedAt: FilterUpdatedAt },
    ratings: { [movie.ttId]: ClientRating(movie.ttId, movie.title, movie.year, 8, MovieMediaType) },
    movieById: new Map([[movie.ttId, movie]]),
    recommendationExclusions: [{ title: BlockedMovieTitle, year: 2002 }]
  };
}

function AssertCrossMediaRequest(request) {
  assert.equal(request.count, 7);
  assert.equal(request.mediaType, MovieMediaType);
  assert.equal(request.profile.tasteBasis, OtherTasteBasis);
  assert.equal(request.profile.ratings.length, 5);
  assert.ok(request.profile.ratings.every((rating) => rating.sourceMediaType === TvMediaType));
  assert.deepEqual(request.profile.ratedTargets, [{ title: RatedMovieTitle, year: 2001 }]);
  assert.deepEqual(request.profile.exclusions, [{ title: BlockedMovieTitle, year: 2002 }]);
}

function VerifyBrowserQueueRemoval() {
  const app = BuildQueueRemovalApp();
  assert.equal(app.RemoveRecommendationFromQueue({ title: HeatTitle.toUpperCase(), year: 1995 }), true);
  assert.deepEqual(app.State.recommendationQueue.map((item) => item.ttId), [ThiefId]);
}

function BuildQueueRemovalApp() {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = {
    recommendationQueue: [
      { ttId: HeatId, title: HeatTitle, year: 1995 },
      { ttId: ThiefId, title: ThiefTitle, year: 1981 }
    ],
    ai: { configured: true }
  };
  app.Elements = { recommendationStatus: { textContent: "" } };
  app.RenderRecommendationQueue = NoOp;
  app.ReadAiModelLabel = () => "test model";
  return app;
}

test("browser watchlist items inherit sortable catalog metadata", VerifyBrowserQueueCatalogMetadata);

function VerifyBrowserQueueCatalogMetadata() {
  const app = Object.create(RapidRaterApp.prototype);
  const movie = { ttId: HeatId, title: HeatTitle, year: 1995, imdbRating: 8.3 };
  app.State = { movieById: new Map([[movie.ttId, movie]]) };
  const item = app.NormalizeRecommendationQueueItem({ ttId: movie.ttId, title: movie.title, year: movie.year });
  assert.equal(item.imdbRating, 8.3);
}

test("browser watchlist exposes only recommendations inside the active filters", VerifyVisibleRecommendations);

function VerifyVisibleRecommendations() {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = {
    filters: { includedGenres: [DocumentaryGenre], minYear: 2010, includedOriginalLanguages: [EnglishLanguage] },
    recommendationQueue: [
      { title: FreeSoloTitle, year: 2018, genres: [DocumentaryGenre], originalLanguage: EnglishLanguage },
      { title: HeatTitle, year: 1995, genres: [CrimeGenre], originalLanguage: EnglishLanguage },
      { title: "The Rescue", year: 2021, genres: [DocumentaryGenre], originalLanguage: "th" }
    ]
  };
  app.Social = { filterMode: "all" };
  app.Elements = { recommendationSort: { value: AddedSortField } };
  app.RecommendationSortDescending = true;
  assert.deepEqual(app.ReadVisibleRecommendations().map((item) => item.title), [FreeSoloTitle]);
}

function VerifyRatingQueueRebuild() {
  const app = BuildRatingQueueApp();
  app.RebuildQueue();
  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), [CollateralId]);
}

function BuildRatingQueueApp() {
  const app = Object.create(RapidRaterApp.prototype);
  const movies = BuildRatingMovies();
  app.State = BuildRatingQueueState(movies);
  return app;
}

function BuildRatingMovies() {
  return [
    { ttId: HeatId, title: HeatTitle },
    { ttId: ThiefId, title: ThiefTitle },
    { ttId: CollateralId, title: CollateralTitle }
  ];
}

function BuildRatingQueueState(movies) {
  return {
    movies,
    movieById: new Map(movies.map((movie) => [movie.ttId, movie])),
    ratings: { [ThiefId]: { status: RatedStatus } },
    recommendationQueue: [{ ttId: HeatId, title: HeatTitle, year: 1995 }],
    savedQueueIds: [HeatId, ThiefId, CollateralId]
  };
}

async function VerifyActiveWishlist() {
  const fixture = BuildActiveWishlistFixture();
  const button = BuildWishlistButton(fixture.classes);
  assert.equal(await fixture.app.AddActiveMovieToWishlist(button), true);
  AssertActiveWishlist(fixture, button);
}

function BuildActiveWishlistFixture() {
  const app = Object.create(RapidRaterApp.prototype);
  const heat = { ttId: HeatId, title: HeatTitle, year: 1995, genres: [CrimeGenre, FilterGenre] };
  const thief = { ttId: ThiefId, title: ThiefTitle, year: 1981, genres: [CrimeGenre] };
  app.State = BuildActiveWishlistState(heat, thief);
  app.NewActionId = () => "5d226a99-19c4-463a-9f0f-cbe9d717a641";
  InstallWishlistRequest(app, heat, thief);
  const counters = InstallWishlistSpies(app);
  return { app, heat, thief, counters, classes: new Set() };
}

function BuildActiveWishlistState(heat, thief) {
  return {
    movies: [heat, thief],
    movieById: new Map([[heat.ttId, heat], [thief.ttId, thief]]),
    queue: [heat, thief],
    savedQueueIds: [heat.ttId, thief.ttId],
    queueRevision: 7,
    queuePoolVersion: PoolVersion,
    queueReady: true,
    ratings: {},
    recommendationQueue: [],
    locked: false
  };
}

function InstallWishlistRequest(app, heat, thief) {
  app.RequestJson = async (url, method, body) => {
    AssertWishlistRequest(url, method, body, heat);
    return {
      ok: true,
      recommendations: [{ ...heat, queueKey: HeatQueueKey }],
      queue: { revision: 8, poolVersion: PoolVersion, queueIds: [thief.ttId] }
    };
  };
}

function AssertWishlistRequest(url, method, body, heat) {
  assert.equal(url, "/api/rater/decision");
  assert.equal(method, "PUT");
  assert.equal(body.expectedRevision, 7);
  assert.equal(body.kind, "wishlist");
  assert.equal(body.titleId, heat.ttId);
}

function InstallWishlistSpies(app) {
  const counters = { persisted: 0, rendered: 0, recommendationRendered: 0, toast: "" };
  app.PersistStateNow = () => counters.persisted++;
  app.Render = () => counters.rendered++;
  app.RenderRecommendationQueue = () => counters.recommendationRendered++;
  app.UpdateRecommendationStatus = () => undefined;
  app.ShowToast = (value) => counters.toast = value;
  return counters;
}

function BuildWishlistButton(classes) {
  return {
    disabled: false,
    innerHTML: "<span>☆</span> Add to watchlist",
    textContent: "",
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    }
  };
}

function AssertActiveWishlist({ app, counters, classes }, button) {
  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), [ThiefId]);
  assert.deepEqual(app.State.recommendationQueue.map((movie) => movie.ttId), [HeatId]);
  assert.equal(app.State.locked, false);
  assert.deepEqual([counters.persisted, counters.rendered, counters.recommendationRendered], [0, 1, 1]);
  assert.match(counters.toast, /added to your watchlist/);
  assert.equal(button.disabled, false);
  assert.equal(classes.has("saving"), false);
}

test("recommendation watchlist renders one continuous poster grid", VerifyRecommendationGrid);
test("recommendation watchlist sorts client-side with stable title ties", VerifyRecommendationSorting);
test("recommendation sort controls choose sensible directions and rerender", VerifyRecommendationSortControls);
test("recommendation details open from a tile and restore focus when closed", VerifyRecommendationDetailsInteraction);
test("watching options open from a watchlist tile and request streaming metadata", VerifyRecommendationWatchInteraction);

function VerifyRecommendationGrid() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { recommendationSort: { value: RecommendationSortFields.addedAt } };
  const html = app.BuildRecommendationCards(BuildRecommendationGridItems());
  assert.equal((html.match(/data-recommendation-details/g) || []).length, 4);
  assert.equal((html.match(/data-recommendation-watch/g) || []).length, 4);
  assert.equal((html.match(/class="recommendation-poster(?:\s|")/g) || []).length, 4);
  assert.doesNotMatch(html, /recommendation-row|data-row-key/);
  assert.ok(html.indexOf(HeatTitle) < html.indexOf(ManhunterTitle));
}

function BuildRecommendationGridItems() {
  return [
    QueueItem(HeatQueueKey, HeatId, HeatTitle, 1995),
    QueueItem(ThiefQueueKey, ThiefId, ThiefTitle, 1981),
    QueueItem("collateral|2004", CollateralId, CollateralTitle, 2004),
    QueueItem(ManhunterQueueKey, ManhunterId, ManhunterTitle, 1986)
  ];
}

function VerifyRecommendationSorting() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { recommendationSort: { value: AddedSortField } };
  app.RecommendationSortDescending = true;
  const items = [
    { ...QueueItem(HeatQueueKey, HeatId, HeatTitle, 1995), addedAt: "2026-07-20T12:00:00.000Z" },
    { ...QueueItem(ThiefQueueKey, ThiefId, ThiefTitle, 1981), addedAt: AddedAtTimestamp },
    { ...QueueItem("alien|1979", "tt0078748", AlienTitle, 1979), addedAt: AddedAtTimestamp }
  ];

  assert.deepEqual(app.SortRecommendations(items).map((item) => item.title), [AlienTitle, ThiefTitle, HeatTitle]);
  app.Elements.recommendationSort.value = TitleSortField;
  app.RecommendationSortDescending = false;
  assert.deepEqual(app.SortRecommendations(items).map((item) => item.title), [AlienTitle, HeatTitle, ThiefTitle]);
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
  const item = QueueItem(HeatQueueKey, HeatId, HeatTitle, 1995);
  let focused = 0;
  const button = BuildRecommendationDetailsButton(item, () => { focused++; });
  app.State = { recommendationQueue: [item] };
  app.Elements = BuildRecommendationDetailsElements(() => { focused++; });
  app.EnrichTitleMetadata = NoOp;
  app.ApplySocialContextToCards = () => false;
  app.ShowRecommendationDetails(button);
  AssertRecommendationDetailsOpen(app);
  app.HideRecommendationDetails();
  AssertRecommendationDetailsClosed(app, focused);
}

function VerifyRecommendationWatchInteraction() {
  const app = Object.create(RapidRaterApp.prototype);
  const item = QueueItem(HeatQueueKey, HeatId, HeatTitle, 1995);
  const request = {};
  app.State = { recommendationQueue: [item], metadata: {} };
  app.Elements = BuildRecommendationDetailsElements(NoOp);
  app.EnrichTitleMetadata = (ttId, streaming) => Object.assign(request, { ttId, streaming });
  app.ShowRecommendationWatch(BuildRecommendationDetailsButton(item, NoOp));
  assert.match(app.Elements.recommendationDetailsContent.innerHTML, /Where to watch/);
  assert.deepEqual(request, { ttId: item.ttId, streaming: true });
}

function BuildRecommendationSortElements(attributes) {
  return {
    recommendationSort: { value: TitleSortField },
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

test("AI Picks hides both rating bars and removes the mobile bottom-bar layout state", VerifyAiView);
test("AI generation sends the saved queue and refills after server-side duplicate filtering", VerifyAiGeneration);
test("AI generation sends active filters and rejects catalog matches outside them", VerifyFilteredAiGeneration);
test("cross-media taste titles are evidence, while target ratings remain blocked", VerifyCrossMediaAiGeneration);

function VerifyAiView() {
  const classes = new Set([ActiveRaterClass]);
  const originalDocument = globalThis.document;
  globalThis.document = BuildViewDocument(classes);
  try {
    const app = BuildAiViewApp();
    app.ShowView("ai");
    AssertAiView(app, classes);
  } finally {
    globalThis.document = originalDocument;
  }
}

function BuildViewDocument(classes) {
  return {
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
}

function BuildAiViewApp() {
  const app = Object.create(RapidRaterApp.prototype);
  app.State = { activeView: "rater" };
  app.Elements = ViewElements();
  app.UpdateRecommendationBasisControl = NoOp;
  app.UpdateRecommendationStatus = NoOp;
  app.UpdateSyncView = NoOp;
  return app;
}

function AssertAiView(app, classes) {
  assert.equal(app.Elements.recommendationView.hidden, false);
  assert.equal(app.Elements.ratingFooter.hidden, true);
  assert.equal(app.Elements.mobileRatingBar.hidden, true);
  assert.equal(classes.has(ActiveRaterClass), false);
  assert.equal(classes.has("ai-active"), true);
}

async function VerifyAiGeneration() {
  const calls = [];
  const responses = BuildAiResponses();
  const options = BuildAiOptions(calls, responses);
  const result = await GenerateAiRecommendations(process.cwd(), options);
  AssertAiGeneration(result, calls);
}

function BuildAiResponses() {
  return [
    { summary: "First pass", recommendations: [Recommendation(HeatTitle, 1995), Recommendation(ThiefTitle, 1981)] },
    { summary: "Refill", recommendations: [Recommendation(ThiefTitle, 1981), Recommendation(CollateralTitle, 2004)] }
  ];
}

function BuildAiOptions(calls, responses) {
  return {
    baseUrl: TestAiBaseUrl,
    model: TestModel,
    count: 2,
    requestAiChat: BuildChatRequester(calls, responses),
    queue: [{ ttId: HeatId, title: HeatTitle, year: 1995 }],
    profile: { ratings: BuildTasteRatings(), exclusions: [{ title: AlienTitle, year: 1979 }] }
  };
}

function AssertAiGeneration(result, calls) {
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.recommendations.map((item) => item.title), [ThiefTitle, CollateralTitle]);
  assert.equal(calls.length, 2);
  const firstProfile = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(firstProfile.queue, [{ title: HeatTitle, year: 1995 }]);
  assert.deepEqual(firstProfile.exclusions, [{ title: AlienTitle, year: 1979 }]);
  assert.equal(firstProfile.ratings.length, 5);
  assert.ok(calls[0].messages[0].content.includes(`"${MinimumItemsField}":2`));
  assert.ok(calls[1].messages[0].content.includes(`"${MinimumItemsField}":1`));
}

async function VerifyFilteredAiGeneration() {
  const rootPath = await CreateCatalogRoot("rapid-rater-ai-filters-", BuildFilteredCatalog());
  const calls = [];
  const responses = [Recommendation(HeatTitle, 1995), Recommendation(ParasiteTitle, 2019)];
  try {
    const result = await GenerateAiRecommendations(rootPath, BuildFilteredOptions(calls, responses));
    AssertFilteredGeneration(result, calls);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

function BuildFilteredCatalog() {
  return [
    BuildHeatCatalogTitle(),
    BuildParasiteCatalogTitle()
  ];
}

function BuildHeatCatalogTitle() {
  return {
    ttId: HeatId,
    title: HeatTitle,
    year: 1995,
    genres: [CrimeGenre],
    imdbRating: 8.3,
    runtimeMinutes: 170,
    originCountries: [UsCountry],
    originalLanguage: EnglishLanguage
  };
}

function BuildParasiteCatalogTitle() {
  return {
    ttId: "tt6751668",
    title: ParasiteTitle,
    year: 2019,
    genres: [CrimeGenre, FilterGenre],
    imdbRating: 8.5,
    runtimeMinutes: 132,
    originCountries: ["KR"],
    originalLanguage: KoreanLanguage
  };
}

function BuildFilteredOptions(calls, responses) {
  return {
    baseUrl: TestAiBaseUrl,
    model: TestModel,
    count: 1,
    requestAiChat: BuildRecommendationRequester(calls, responses, "Filtered"),
    filters: BuildActiveFilters(),
    profile: { ratings: BuildTasteRatings() }
  };
}

function BuildActiveFilters() {
  return {
    minYear: 2000,
    includedGenres: [FilterGenre],
    documentaryMode: DocumentaryExcludeMode,
    minImdbRating: 8,
    maxRuntimeMinutes: 150,
    includedOriginalLanguages: [KoreanLanguage],
    excludedOriginCountries: [UsCountry],
    updatedAt: FilterUpdatedAt
  };
}

function AssertFilteredGeneration(result, calls) {
  assert.deepEqual(result.payload.recommendations.map((item) => item.title), [ParasiteTitle]);
  assert.equal(calls.length, 2);
  const filters = JSON.parse(calls[0].messages[1].content).filters;
  assert.deepEqual(filters, BuildExpectedFilters());
}

function BuildExpectedFilters() {
  return {
    minYear: 2000,
    maxYear: null,
    includedGenres: [FilterGenre],
    documentaryMode: DocumentaryExcludeMode,
    minImdbRating: 8,
    maxRuntimeMinutes: 150,
    includedOriginCountries: [],
    includedOriginalLanguages: [KoreanLanguage],
    excludedOriginCountries: [UsCountry],
    excludedOriginalLanguages: [],
    excludeBollywood: false, includeUnknownOrigin: true
  };
}

async function VerifyCrossMediaAiGeneration() {
  const rootPath = await CreateCatalogRoot("rapid-rater-ai-cross-media-", BuildCrossMediaCatalog());
  const calls = [];
  const responses = [Recommendation(AlreadyRatedTitle, 2001), Recommendation(SharedTasteTitle, 2020)];
  try {
    const result = await GenerateAiRecommendations(rootPath, BuildCrossMediaOptions(calls, responses));
    AssertCrossMediaGeneration(result, calls);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

async function CreateCatalogRoot(prefix, movies) {
  const rootPath = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(rootPath, DataDirectory));
  await writeFile(path.join(rootPath, DataDirectory, "movies.json"), JSON.stringify({ movies }));
  return rootPath;
}

function BuildCrossMediaCatalog() {
  return [
    { ttId: "tt0000010", title: AlreadyRatedTitle, year: 2001 },
    { ttId: "tt0000011", title: SharedTasteTitle, year: 2020 }
  ];
}

function BuildCrossMediaOptions(calls, responses) {
  return {
    baseUrl: TestAiBaseUrl,
    model: TestModel,
    count: 1,
    requestAiChat: BuildRecommendationRequester(calls, responses, "Cross-media"),
    mediaType: MovieMediaType,
    targetRatings: [{ ...Rating(AlreadyRatedTitle, 2001, 8), mediaType: MovieMediaType }],
    targetExclusions: [{ title: MovieExclusionTitle, year: 2002 }],
    profile: { tasteBasis: OtherTasteBasis, ratings: BuildCrossMediaRatings(), ratedTargets: [] }
  };
}

function BuildCrossMediaRatings() {
  return [
    { ...Rating(SharedTasteTitle, 2020, 10), sourceMediaType: TvMediaType },
    { ...Rating("Series Two", 2019, 9), sourceMediaType: TvMediaType },
    { ...Rating("Series Three", 2018, 8), sourceMediaType: TvMediaType },
    { ...Rating("Series Four", 2017, 8), sourceMediaType: TvMediaType },
    { ...Rating("Series Five", 2016, 7), sourceMediaType: TvMediaType }
  ];
}

function AssertCrossMediaGeneration(result, calls) {
  assert.deepEqual(result.payload.recommendations.map((item) => item.title), [SharedTasteTitle]);
  assert.equal(calls.length, 2);
  const profile = JSON.parse(calls[0].messages[1].content);
  assert.equal(profile.mediaType, MovieMediaType);
  assert.equal(profile.tasteBasis, OtherTasteBasis);
  assert.equal(profile.ratings[0].sourceMediaType, TvMediaType);
  assert.deepEqual(profile.ratedTargets, [{ title: AlreadyRatedTitle, year: 2001 }]);
  assert.deepEqual(profile.exclusions, [{ title: MovieExclusionTitle, year: 2002 }]);
  assert.match(calls[0].messages[0].content, /return only movies/i);
}

function BuildTasteRatings() {
  return [
    Rating("The Godfather", 1972, 10),
    Rating("Goodfellas", 1990, 9),
    Rating("Jaws", 1975, 8),
    Rating("Arrival", 2016, 8),
    Rating("Memento", 2000, 9)
  ];
}

function Recommendation(title, year) {
  return {
    title,
    year,
    genres: [CrimeGenre],
    why: { tasteMatch: MatchReason, ratingEvidence: ["Evidence"] }
  };
}

function Rating(title, year, rating) {
  return { title, year, genres: [FilterGenre], rating };
}

function BuildChatRequester(calls, responses) {
  return async (_options, messages, maxTokens) => {
    calls.push({ messages, maxTokens });
    return { status: 200, payload: { ok: true, content: JSON.stringify(responses.shift()), model: TestModel } };
  };
}

function BuildRecommendationRequester(calls, responses, summary) {
  const payloads = responses.map((recommendation) => ({ summary, recommendations: [recommendation] }));
  return BuildChatRequester(calls, payloads);
}

function ClientRating(ttId, title, year, rating, mediaType) {
  return { ttId, title, year, rating, mediaType, status: RatedStatus, at: `${year}-01-01T00:00:00.000Z` };
}

function QueueItem(queueKey, ttId, title, year) {
  return {
    queueKey,
    ttId,
    title,
    year,
    genres: [CrimeGenre],
    why: { tasteMatch: MatchReason, ratingEvidence: [] }
  };
}

function ViewElements() {
  return { ...BuildViewPanels(), ...BuildViewTabs() };
}

function BuildViewPanels() {
  return {
    raterView: { hidden: false },
    recommendationView: { hidden: true },
    settingsView: { hidden: true },
    syncView: { hidden: true },
    friendsView: { hidden: true },
    ratingFooter: { hidden: false },
    mobileRatingBar: { hidden: false }
  };
}

function BuildViewTabs() {
  const classList = { toggle: NoOp, remove: NoOp };
  return {
    tabRater: { classList },
    tabAi: { classList },
    tabSync: { classList },
    tabFriends: { classList }
  };
}
