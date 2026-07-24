import { GenerateAiRecommendations } from "./ai-recommendations.mjs";
import { Authenticate, EnsureCsrfToken, HashPassword, LoginLimiter, RegenerateSession, RegistrationLimiter, RegistrationSchema, RequireAuth, RequireCsrf } from "./auth.mjs";
import { DiscoverAiModels, TestAiConnection } from "./ai-client.mjs";
import { GetImdbStatus } from "./imdb-ratings.mjs";
import { GetTitleMetadata } from "./title-metadata.mjs";
import { CreateTitleMetadataStore } from "./title-metadata-store.mjs";
import { HasSecretProtectionConfiguration } from "./security/secret-protection-config.mjs";
import { NormalizeRecommendationItem, RecommendationKey } from "./recommendation-queue.mjs";
import { ReadMoviePool, ReadTitlePool } from "./movie-pool.mjs";
import { CreateRaterEvents } from "./rater-events.mjs";
import { NormalizeMediaType, ReadMediaPayload } from "../shared/media.js";
import { ReadStreamingCountry } from "../shared/streaming-country.js";
import { NormalizeKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";
import { NormalizeHelpPreferences } from "../shared/help-preferences.js";
import { RegisterSocialRoutes } from "./social-routes.mjs";
import { AiConnectionIdSchema, AiConnectionSchema, AiModelDiscoverySchema, CombinedTasteValue, DeleteRateSchema, MediaTypeSchema, MineTasteAudience, MovieMediaType, NotSeenDecisionKind, NotSeenSchema, PendingSubmitStatus, PreferencesSchema, QuickRatingSchema, RateSchema, RatedDecisionKind, RaterDecisionSchema, RaterQueueRestoreSchema, RaterUndoSchema, RecommendationExclusionSchema, RecommendationQueueItemSchema, SecretSchema, SkippedSubmitStatus, SocialTasteSchema, StateSchema, WishlistDecisionKind } from "./route-schemas.mjs";
import { IsCustomAiProvider, ListAiProviders, ReadProviderName, ResolveAiBaseUrl } from "./ai-providers.mjs";

const TelevisionMediaType = "tv";
const RaterConflictError = "The rating queue changed on another device.";
const RatingSystemSource = "rating-system";
const RatingQueueTasteMatch = "Added from the rating queue.";
const DisabledAnalyticsConfig = Object.freeze({ enabled: false, token: "", host: "" });
const ImdbSecretType = "imdb";
const SecretTypes = new Set([ImdbSecretType]);
const AccountStatePath = "/api/account/state";
const AccountSecretPath = "/api/account/secrets/:type";
const AiRecommendationQueuePath = "/api/ai/recommendations/queue";
const AiRecommendationsPath = "/api/ai/recommendations";
const AiConnectionsPath = "/api/ai/connections";
const HandleUniqueConstraint = "user_profiles_handle_unique";
const FunctionType = "function";
const RatePath = "/api/rate";
const RaterQueuePath = "/api/rater/queue";

export function RegisterApiRoutes(app, options) {
  const dependencies = NormalizeRouteDependencies(options);
  RegisterPublicRoutes(app, dependencies);
  app.use("/api", RequireAuth);
  RegisterSocialRoutes(app, BuildSocialDependencies(dependencies));
  RegisterAccountRoutes(app, dependencies);
  RegisterRaterRoutes(app, dependencies);
  RegisterImdbRoutes(app, dependencies);
  RegisterAiRoutes(app, dependencies);
  RegisterTitleRoutes(app, dependencies);
}

function NormalizeRouteDependencies(options) {
  const { tmdbApiKey = "", generateAiRecommendations = GenerateAiRecommendations, discoverAiModels = DiscoverAiModels, testAiConnection = TestAiConnection } = options;
  const { readMoviePool = ReadMoviePool, readTitlePool = ReadTitlePool, raterEvents = CreateRaterEvents() } = options;
  const analyticsConfig = options.analyticsConfig || DisabledAnalyticsConfig;
  return {
    ...options, tmdbApiKey, analyticsConfig, generateAiRecommendations, discoverAiModels, testAiConnection, readMoviePool, readTitlePool, raterEvents,
    metadataStore: options.titleMetadataStore || CreateTitleMetadataStore(options.pool)
  };
}

function BuildSocialDependencies(dependencies) {
  const { store, rootPath, readMoviePool, readTitlePool, raterEvents } = dependencies;
  return {
    store, rootPath, readMoviePool, readTitlePool,
    onRecommendationDelivered: async (userId, mediaType) => await ReconcileRaterQueue(store, userId, mediaType, rootPath, readMoviePool, readTitlePool, raterEvents)
  };
}

function RegisterPublicRoutes(app, dependencies) {
  app.get("/health", async (_request, response) => await HandleHealth(response, dependencies));
  app.get("/api/auth/session", async (request, response) => HandleSession(request, response, dependencies.analyticsConfig));
  app.post("/api/auth/login", LoginLimiter, RequireCsrf, async (request, response) => await HandleLogin(request, response, dependencies));
  app.post("/api/auth/register", RegistrationLimiter, RequireCsrf, async (request, response) => await HandleRegistration(request, response, dependencies));
  app.post("/api/auth/logout", RequireAuth, RequireCsrf, async (request, response) => await HandleLogout(request, response));
}

function RegisterAccountRoutes(app, dependencies) {
  app.get(AccountStatePath, async (request, response) => await HandleGetAccountState(request, response, dependencies));
  app.put(AccountStatePath, RequireCsrf, async (request, response) => await HandlePutAccountState(request, response, dependencies));
  app.put("/api/account/not-seen", RequireCsrf, async (request, response) => await HandleNotSeen(request, response, dependencies));
  app.put("/api/account/recommendation-exclusions", RequireCsrf, async (request, response) => await HandleRecommendationExclusion(request, response, dependencies));
  app.put("/api/account/preferences", RequireCsrf, async (request, response) => await HandlePreferences(request, response, dependencies));
  app.put(AccountSecretPath, RequireCsrf, async (request, response) => await HandlePutSecret(request, response, dependencies));
  app.delete(AccountSecretPath, RequireCsrf, async (request, response) => await HandleDeleteSecret(request, response, dependencies));
}

function RegisterRaterRoutes(app, dependencies) {
  app.get(RaterQueuePath, async (request, response) => await HandleGetRaterQueue(request, response, dependencies));
  app.get("/api/rater/events", (request, response) => HandleRaterEvents(request, response, dependencies));
  app.put("/api/rater/decision", RequireCsrf, async (request, response) => await HandleRaterDecision(request, response, dependencies));
  app.put("/api/rater/quick-rating", RequireCsrf, async (request, response) => await HandleQuickRating(request, response, dependencies));
  app.put("/api/rater/undo", RequireCsrf, async (request, response) => await HandleRaterUndo(request, response, dependencies));
  app.put(RaterQueuePath, RequireCsrf, async (request, response) => await HandleRestoreRaterQueue(request, response, dependencies));
}

function RegisterImdbRoutes(app, dependencies) {
  app.get("/api/imdb/status", async (request, response) => await HandleImdbStatus(request, response, dependencies));
  app.post(RatePath, RequireCsrf, async (request, response) => await HandleQueueRating(request, response, dependencies));
  app.post("/api/imdb/retry", RequireCsrf, async (request, response) => await HandleRetryRatings(request, response, dependencies));
  app.delete(RatePath, RequireCsrf, async (request, response) => await HandleDeleteRating(request, response, dependencies));
}

function RegisterAiRoutes(app, dependencies) {
  app.get("/api/ai/status", async (request, response) => await HandleAiStatus(request, response, dependencies));
  app.get(AiConnectionsPath, async (request, response) => await HandleAiStatus(request, response, dependencies));
  app.post("/api/ai/models", RequireCsrf, async (request, response) => await HandleAiModels(request, response, dependencies));
  app.post(AiConnectionsPath, RequireCsrf, async (request, response) => await HandleCreateAiConnection(request, response, dependencies));
  app.put(`${AiConnectionsPath}/:id`, RequireCsrf, async (request, response) => await HandleUpdateAiConnection(request, response, dependencies));
  app.delete(`${AiConnectionsPath}/:id`, RequireCsrf, async (request, response) => await HandleDeleteAiConnection(request, response, dependencies));
  app.put(`${AiConnectionsPath}/:id/default`, RequireCsrf, async (request, response) => await HandleDefaultAiConnection(request, response, dependencies));
  app.get(AiRecommendationQueuePath, async (request, response) => await HandleGetRecommendationQueue(request, response, dependencies));
  app.put(AiRecommendationQueuePath, RequireCsrf, async (request, response) => await HandlePutRecommendationQueue(request, response, dependencies));
  app.post(AiRecommendationsPath, RequireCsrf, async (request, response) => await HandleGenerateRecommendations(request, response, dependencies));
}

function RegisterTitleRoutes(app, dependencies) {
  app.get(/^\/api\/title\/(tt\d{1,30})$/, async (request, response) => await HandleTitleMetadata(request, response, dependencies));
}

async function HandleHealth(response, dependencies) {
  await dependencies.pool.query("SELECT 1");
  response.json({ ok: true, database: "connected", encryptionConfigured: HasSecretProtectionConfiguration() });
}

function HandleSession(request, response, analyticsConfig) {
  const csrfToken = EnsureCsrfToken(request);
  const payload = { ok: true, csrfToken, analytics: analyticsConfig, registrationEnabled: IsRegistrationEnabled() };
  if (!request.session.userId)
    return response.json({ ...payload, authenticated: false });
  response.json({ ...payload, authenticated: true, user: SessionUser(request) });
}

async function HandleLogin(request, response, dependencies) {
  const user = await Authenticate(dependencies.store, request.body);
  if (!user)
    return response.status(401).json({ ok: false, code: "INVALID_LOGIN", error: "The email or password is incorrect." });
  await RegenerateSession(request, user);
  response.json({ ok: true, csrfToken: request.session.csrfToken, user: PublicUser(user) });
}

async function HandleRegistration(request, response, dependencies) {
  if (!IsRegistrationEnabled())
    return response.status(403).json({ ok: false, code: "REGISTRATION_DISABLED", error: "New account registration is temporarily unavailable." });
  const parsed = RegistrationSchema.safeParse(request.body);
  if (!parsed.success)
    return response.status(422).json({ ok: false, code: "INVALID_REGISTRATION", error: parsed.error.issues[0]?.message || "The account details are invalid." });
  if (await dependencies.store.findUserByEmail(parsed.data.email))
    return EmailUnavailable(response);
  return await CreateRegisteredUser(request, response, dependencies.store, parsed.data);
}

async function CreateRegisteredUser(request, response, store, registration) {
  try {
    const user = await store.createUser({ email: registration.email, passwordHash: await HashPassword(registration.password), handle: registration.handle });
    await RegenerateSession(request, user);
    response.status(201).json({ ok: true, csrfToken: request.session.csrfToken, user: PublicUser(user) });
  } catch (error) {
    if (error?.constraint === HandleUniqueConstraint)
      return UsernameUnavailable(response);
    if (error?.code === "23505")
      return EmailUnavailable(response);
    throw error;
  }
}

async function HandleLogout(request, response) {
  await DestroySession(request);
  const secure = /^https:/i.test(process.env.APP_ORIGIN || "");
  response.clearCookie(ReadSessionCookieName(), { path: "/", httpOnly: true, sameSite: "lax", secure });
  response.json({ ok: true });
}

async function HandleGetAccountState(request, response, dependencies) {
  const userId = request.session.userId;
  const pending = [dependencies.store.getBundle(userId), ReadImdbQueueStatus(dependencies.store, userId), ReadAiConnections(dependencies.store, userId)];
  const [bundle, imdbQueue, aiConnections] = await Promise.all(pending);
  response.json({ ok: true, user: SessionUser(request), ...BuildBundle(bundle, aiConnections), imdbQueue });
}

async function HandlePutAccountState(request, response, dependencies) {
  const parsed = StateSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const result = await dependencies.store.saveState(request.session.userId, parsed.data.payload, parsed.data.ratingsCsv, parsed.data.revision);
  if (!result.ok)
    return response.status(409).json({ ok: false, code: "STATE_CONFLICT", error: "Your account changed in another browser.", current: result.current });
  await ReconcileUserQueue(request, parsed.data.mediaType, dependencies);
  response.json({ ok: true, revision: result.revision });
}

async function HandleNotSeen(request, response, dependencies) {
  const parsed = NotSeenSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const record = BuildNotSeenRecord(parsed.data);
  const revision = await dependencies.store.recordRating(request.session.userId, record, parsed.data.mediaType);
  await ReconcileUserQueue(request, parsed.data.mediaType, dependencies);
  response.json({ ok: true, titleId: record.ttId, revision });
}

async function HandleRecommendationExclusion(request, response, dependencies) {
  const parsed = RecommendationExclusionSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const exclusion = BuildRecommendationExclusion(parsed.data);
  const revision = await dependencies.store.excludeRecommendation(request.session.userId, exclusion, parsed.data.mediaType);
  response.json({ ok: true, exclusion, revision });
}

async function HandlePreferences(request, response, dependencies) {
  const parsed = PreferencesSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  await dependencies.store.savePreferences(request.session.userId, parsed.data);
  response.json({ ok: true, ...parsed.data });
}

async function HandlePutSecret(request, response, dependencies) {
  const secretType = ReadSecretType(request, response);
  if (!secretType)
    return;
  const parsed = SecretSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const value = NormalizeSecret(secretType, parsed.data.value);
  if (secretType === ImdbSecretType && !/(?:^|;\s*)at-main=/.test(value))
    return response.status(422).json({ ok: false, code: "COOKIE_NOT_SIGNED_IN", error: "That IMDb cookie does not include at-main." });
  await dependencies.store.putSecret(request.session.userId, secretType, value);
  const resumed = secretType === ImdbSecretType ? await dependencies.store.ResumeImdbRatingJobs(request.session.userId) : null;
  response.json({ ok: true, configured: true, resumedJobs: resumed?.queued || 0, revision: resumed?.revision });
}

async function HandleDeleteSecret(request, response, dependencies) {
  const secretType = ReadSecretType(request, response);
  if (!secretType)
    return;
  await dependencies.store.deleteSecret(request.session.userId, secretType);
  response.json({ ok: true, configured: false });
}

async function HandleGetRaterQueue(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const titlePool = await ReadRequestedPool(dependencies.rootPath, mediaType, dependencies.readMoviePool, dependencies.readTitlePool);
  const queue = await dependencies.store.getRaterQueue(request.session.userId, mediaType, titlePool);
  response.json({ ok: true, queue });
}

function HandleRaterEvents(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  dependencies.raterEvents.subscribe(request.session.userId, request, response, mediaType);
}

async function HandleRaterDecision(request, response, dependencies) {
  const parsed = RaterDecisionSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const mediaType = parsed.data.mediaType;
  await PrepareRaterQueue(request.session.userId, mediaType, dependencies);
  const decision = BuildRaterDecision(parsed.data);
  const committed = await dependencies.store.commitRaterDecision(request.session.userId, decision);
  if (!committed.ok)
    return RaterConflict(response, committed);
  dependencies.raterEvents.publish(request.session.userId, committed.queue.revision, mediaType);
  await AddWishlistRecommendations(request.session.userId, mediaType, decision, committed, dependencies.store);
  response.json({ ok: true, ...committed });
}

async function PrepareRaterQueue(userId, mediaType, dependencies) {
  const titlePool = await ReadRequestedPool(dependencies.rootPath, mediaType, dependencies.readMoviePool, dependencies.readTitlePool);
  await dependencies.store.getRaterQueue(userId, mediaType, titlePool);
}

async function AddWishlistRecommendations(userId, mediaType, decision, committed, store) {
  if (decision.kind === WishlistDecisionKind)
    committed.recommendations = await store.listRecommendationQueue(userId, mediaType);
}

async function HandleRaterUndo(request, response, dependencies) {
  const parsed = RaterUndoSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const result = await dependencies.store.commitRaterUndo(request.session.userId, BuildUndoDecision(parsed.data));
  if (!result.ok)
    return RaterConflict(response, result);
  dependencies.raterEvents.publish(request.session.userId, result.queue.revision, parsed.data.mediaType);
  response.json({ ok: true, ...result });
}

function BuildUndoDecision(request) {
  return { actionId: request.actionId, expectedRevision: request.expectedRevision, ttId: request.titleId, mediaType: request.mediaType };
}

async function HandleRestoreRaterQueue(request, response, dependencies) {
  const parsed = RaterQueueRestoreSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const mediaType = parsed.data.mediaType;
  const titlePool = await ReadRequestedPool(dependencies.rootPath, mediaType, dependencies.readMoviePool, dependencies.readTitlePool);
  const result = await dependencies.store.replaceRaterQueue(request.session.userId, parsed.data, mediaType, titlePool);
  if (!result.ok)
    return RaterConflict(response, result);
  dependencies.raterEvents.publish(request.session.userId, result.queue.revision, mediaType);
  response.json({ ok: true, ...result });
}

function RaterConflict(response, result) {
  return response.status(409).json({ ok: false, code: result.code, error: RaterConflictError, current: result.current });
}

async function HandleImdbStatus(request, response, dependencies) {
  const cookie = await dependencies.store.getSecret(request.session.userId, ImdbSecretType);
  const imdbQueue = await dependencies.store.ReadImdbRatingQueueStatus(request.session.userId);
  response.json({ ...GetImdbStatus(), configured: Boolean(cookie) || GetImdbStatus().dryRun, imdbQueue });
}

async function HandleQueueRating(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const parsed = RateSchema.safeParse({ ...request.body, mediaType });
  if (!parsed.success)
    return Invalid(response);
  const record = BuildQueuedRatingRecord(parsed.data);
  const queued = await dependencies.store.QueueImdbRating(request.session.userId, record, mediaType);
  await ReconcileUserQueue(request, mediaType, dependencies);
  response.status(202).json({ ok: true, queued: true, titleId: record.ttId, rating: record.rating, revision: queued.revision, jobId: queued.job.id });
}

async function HandleRetryRatings(request, response, dependencies) {
  const result = await dependencies.store.RetryFailedImdbRatingJobs(request.session.userId);
  response.json({ ok: true, queued: result.queued, revision: result.revision });
}

async function HandleDeleteRating(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const parsed = DeleteRateSchema.safeParse({ ...request.body, mediaType });
  if (!parsed.success)
    return Invalid(response);
  const options = { deferAccountState: parsed.data.deferAccountState };
  const queued = await dependencies.store.QueueImdbDelete(request.session.userId, parsed.data.titleId, mediaType, options);
  response.status(202).json({ ok: true, queued: true, deleted: true, titleId: parsed.data.titleId, revision: queued.revision, jobId: queued.job.id });
}

async function HandleAiStatus(request, response, dependencies) {
  response.json(await BuildAiConnectionState(dependencies.store, request.session.userId));
}

async function HandleAiModels(request, response, dependencies) {
  const parsed = AiModelDiscoverySchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const options = await BuildAiDraftOptions(dependencies.store, request.session.userId, parsed.data);
  if (!options)
    return AiConnectionNotFound(response);
  SendAiModelsResult(response, await dependencies.discoverAiModels(options));
}

async function HandleCreateAiConnection(request, response, dependencies) {
  const parsed = AiConnectionSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const input = { ...parsed.data, connectionId: undefined };
  const options = await BuildAiDraftOptions(dependencies.store, request.session.userId, input);
  const tested = await dependencies.testAiConnection({ ...options, model: parsed.data.model });
  if (!tested.payload.ok)
    return SendResult(response, tested);
  const connection = BuildTestedAiConnection(input, tested.payload);
  await dependencies.store.CreateAiConnection(request.session.userId, connection, options.apiKey);
  await SendAiConnectionState(response, dependencies.store, request.session.userId, 201);
}

async function HandleUpdateAiConnection(request, response, dependencies) {
  const connectionId = ReadAiConnectionId(request, response);
  if (!connectionId)
    return;
  const parsed = AiConnectionSchema.safeParse({ ...request.body, connectionId });
  if (!parsed.success)
    return Invalid(response);
  const options = await BuildAiDraftOptions(dependencies.store, request.session.userId, parsed.data);
  if (!options)
    return AiConnectionNotFound(response);
  await TestAndUpdateAiConnection(request, response, dependencies, parsed.data, options);
}

async function TestAndUpdateAiConnection(request, response, dependencies, input, options) {
  const tested = await dependencies.testAiConnection({ ...options, model: input.model });
  if (!tested.payload.ok)
    return SendResult(response, tested);
  const connection = BuildTestedAiConnection(input, tested.payload);
  const saved = await dependencies.store.UpdateAiConnection(request.session.userId, input.connectionId, connection, options.keyMutation);
  if (!saved)
    return AiConnectionNotFound(response);
  await SendAiConnectionState(response, dependencies.store, request.session.userId);
}

async function HandleDeleteAiConnection(request, response, dependencies) {
  const connectionId = ReadAiConnectionId(request, response);
  if (!connectionId)
    return;
  const removed = await dependencies.store.DeleteAiConnection(request.session.userId, connectionId);
  if (!removed)
    return AiConnectionNotFound(response);
  await SendAiConnectionState(response, dependencies.store, request.session.userId);
}

async function HandleDefaultAiConnection(request, response, dependencies) {
  const connectionId = ReadAiConnectionId(request, response);
  if (!connectionId)
    return;
  const changed = await dependencies.store.SetDefaultAiConnection(request.session.userId, connectionId);
  if (!changed)
    return AiConnectionNotFound(response);
  await SendAiConnectionState(response, dependencies.store, request.session.userId);
}

async function HandleGetRecommendationQueue(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const recommendations = await dependencies.store.listRecommendationQueue(request.session.userId, mediaType);
  response.json({ ok: true, recommendations, count: recommendations.length });
}

async function HandlePutRecommendationQueue(request, response, dependencies) {
  const parsed = RecommendationQueueItemSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const recommendation = BuildQueuedRecommendation(parsed.data);
  const added = await dependencies.store.appendRecommendationQueue(request.session.userId, [recommendation], parsed.data.mediaType);
  const recommendations = await dependencies.store.listRecommendationQueue(request.session.userId, parsed.data.mediaType);
  await ReconcileUserQueue(request, parsed.data.mediaType, dependencies);
  SendRecommendationQueueResponse(response, recommendation, recommendations, added);
}

function BuildQueuedRecommendation(request) {
  const recommendation = {
    ...request,
    source: RatingSystemSource,
    why: { tasteMatch: RatingQueueTasteMatch, ratingEvidence: [] },
    addedAt: new Date().toISOString()
  };
  return NormalizeRecommendationItem(recommendation);
}

function SendRecommendationQueueResponse(response, recommendation, recommendations, added) {
  response.json({ ok: true, recommendation, recommendations, count: recommendations.length, addedCount: added.length });
}

async function HandleGenerateRecommendations(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const options = await BuildSocialAiOptions(dependencies.store, request.session.userId, mediaType, request.body);
  if (!options)
    return Invalid(response);
  const result = await GenerateRecommendations(request, mediaType, options, dependencies);
  await SendGeneratedRecommendations(request, response, mediaType, result, dependencies);
}

async function GenerateRecommendations(request, mediaType, options, dependencies) {
  const queue = await dependencies.store.listRecommendationQueue(request.session.userId, mediaType);
  return await dependencies.generateAiRecommendations(dependencies.rootPath, { ...request.body, ...options, queue, mediaType });
}

async function SendGeneratedRecommendations(request, response, mediaType, result, dependencies) {
  if (!result.payload?.ok)
    return SendResult(response, result);
  const added = await dependencies.store.appendRecommendationQueue(request.session.userId, result.payload.recommendations, mediaType);
  const recommendations = await dependencies.store.listRecommendationQueue(request.session.userId, mediaType);
  await ReconcileUserQueue(request, mediaType, dependencies);
  response.status(result.status).json({ ...result.payload, recommendations, addedCount: added.length, requestedCount: Number(request.body.count) });
}

async function HandleTitleMetadata(request, response, dependencies) {
  const mediaType = ReadRequestMediaType(request, response);
  if (!mediaType)
    return;
  const titleId = request.params[0];
  if (!await IsCatalogTitle(dependencies.rootPath, mediaType, titleId, dependencies.readMoviePool, dependencies.readTitlePool))
    return UnknownTitle(response);
  const includeStreaming = request.query.streaming === "1";
  const preferences = includeStreaming ? await dependencies.store.getPreferences(request.session.userId) : {};
  const streamingCountry = ReadStreamingCountry(preferences.streamingCountry);
  const options = BuildTitleMetadataOptions(dependencies, mediaType, includeStreaming, streamingCountry);
  SendResult(response, await GetTitleMetadata(titleId, options));
}

function BuildTitleMetadataOptions(dependencies, mediaType, includeStreaming, streamingCountry) {
  return {
    tmdbApiKey: dependencies.tmdbApiKey,
    mediaType,
    metadataStore: dependencies.metadataStore,
    streamingAvailabilityService: dependencies.streamingAvailabilityService,
    includeStreaming,
    streamingCountry
  };
}

async function ReconcileUserQueue(request, mediaType, dependencies) {
  const { store, rootPath, readMoviePool, readTitlePool, raterEvents } = dependencies;
  return await ReconcileRaterQueue(store, request.session.userId, mediaType, rootPath, readMoviePool, readTitlePool, raterEvents);
}

async function HandleQuickRating(request, response, dependencies) {
  const parsed = QuickRatingSchema.safeParse(request.body);
  if (!parsed.success)
    return Invalid(response);
  const titlePool = await ReadRequestedPool(dependencies.rootPath, parsed.data.mediaType, dependencies.readMoviePool, dependencies.readTitlePool);
  const title = ReadCatalogTitle(titlePool, parsed.data.titleId);
  if (!title)
    return UnknownTitle(response);
  await dependencies.store.getRaterQueue(request.session.userId, parsed.data.mediaType, titlePool);
  const decision = BuildQuickRatingDecision(parsed.data, title);
  const committed = await dependencies.store.CommitQuickRating(request.session.userId, decision);
  dependencies.raterEvents.publish(request.session.userId, committed.queue.revision, parsed.data.mediaType);
  const recommendations = await dependencies.store.listRecommendationQueue(request.session.userId, parsed.data.mediaType);
  response.json({ ok: true, ...committed, recommendations });
}

function BuildQuickRatingDecision(request, title) {
  const canonical = { ...request, kind: RatedDecisionKind, title: title.title, year: title.year, genres: Array.isArray(title.genres) ? title.genres : [] };
  return BuildRaterDecision(canonical);
}

function ReadCatalogTitle(pool, titleId) {
  const titles = Array.isArray(pool?.titles) ? pool.titles : [];
  return titles.find((title) => title.ttId === titleId) || null;
}

function BuildBundle(bundle, aiConnections = []) {
  return {
    settings: BuildBundleSettings(bundle, aiConnections),
    payload: bundle.state.payload || {},
    ratingsCsv: bundle.state.ratingsCsv || "",
    revision: Number(bundle.state.revision) || 0
  };
}

function BuildBundleSettings(bundle, aiConnections) {
  const configured = aiConnections.some((connection) => Boolean(connection.model));
  return {
    imdbConfigured: bundle.configured.has(ImdbSecretType),
    aiConfigured: configured,
    streamingCountry: ReadStreamingCountry(bundle.preferences.streamingCountry),
    keyboardShortcuts: NormalizeKeyboardShortcuts(bundle.preferences.keyboardShortcuts),
    helpPreferences: NormalizeHelpPreferences(bundle.preferences.helpPreferences)
  };
}

function BuildQueuedRatingRecord(request) {
  return {
    status: RatedDecisionKind,
    rating: request.rating,
    title: request.title,
    year: ReadYear(request.year),
    ttId: request.titleId,
    mediaType: NormalizeMediaType(request.mediaType),
    at: ReadTimestamp(request.at, new Date().toISOString()),
    submitStatus: PendingSubmitStatus,
    submitError: "",
    submittedAt: ""
  };
}

function BuildRaterDecision(request) {
  const base = BuildRaterDecisionBase(request);
  if (request.kind === WishlistDecisionKind)
    return { ...base, recommendation: BuildWishlistRecommendation(request) };
  return { ...base, record: BuildRaterRecord(request) };
}

function BuildRaterDecisionBase(request) {
  return {
    actionId: request.actionId,
    expectedRevision: request.expectedRevision,
    kind: request.kind,
    ttId: request.titleId,
    mediaType: request.mediaType
  };
}

function BuildWishlistRecommendation(request) {
  const recommendation = {
    ttId: request.titleId,
    title: request.title,
    year: ReadYear(request.year) || null,
    genres: request.genres,
    source: RatingSystemSource,
    why: { tasteMatch: RatingQueueTasteMatch, ratingEvidence: [] },
    addedAt: new Date().toISOString()
  };
  return NormalizeRecommendationItem(recommendation);
}

function BuildRaterRecord(request) {
  const at = ReadTimestamp(request.at, new Date().toISOString());
  return {
    status: request.kind,
    rating: request.kind === RatedDecisionKind ? request.rating : null,
    title: request.title,
    year: ReadYear(request.year),
    ttId: request.titleId,
    mediaType: request.mediaType,
    at,
    submitStatus: request.kind === RatedDecisionKind ? PendingSubmitStatus : SkippedSubmitStatus,
    submitError: "",
    submittedAt: ""
  };
}

function BuildNotSeenRecord(request) {
  return {
    status: NotSeenDecisionKind,
    rating: null,
    title: String(request.title || "").trim().slice(0, 500),
    year: ReadYear(request.year),
    ttId: request.titleId,
    mediaType: request.mediaType,
    at: ReadTimestamp(request.at, new Date().toISOString()),
    submitStatus: SkippedSubmitStatus,
    submitError: "",
    submittedAt: ""
  };
}

function BuildRecommendationExclusion(request) {
  const exclusion = {
    ttId: request.ttId || "",
    title: String(request.title || "").trim().slice(0, 500),
    year: ReadYear(request.year) || null,
    at: ReadTimestamp(request.at, new Date().toISOString())
  };
  return { ...exclusion, queueKey: RecommendationKey(exclusion) };
}

function ReadYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : "";
}

function ReadTimestamp(value, fallback) {
  const timestamp = String(value || "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

async function BuildAiOptions(store, userId, mediaType = MovieMediaType, connectionId = "") {
  const [bundle, connections] = await Promise.all([store.getBundle(userId), ReadAiConnections(store, userId)]);
  const connection = SelectAiConnection(connections, connectionId);
  if (connectionId && !connection)
    return null;
  const media = ReadMediaPayload(bundle.state?.payload, mediaType);
  const selected = await BuildSelectedAiOptions(store, userId, connection);
  return {
    ...selected,
    filters: media.filters,
    targetRatings: Object.values(media.ratings || {}),
    targetExclusions: Array.isArray(media.recommendationExclusions) ? media.recommendationExclusions : []
  };
}

async function BuildSocialAiOptions(store, userId, mediaType, request) {
  const socialTaste = SocialTasteSchema.safeParse(request.socialTaste || {});
  if (!socialTaste.success)
    return null;
  const connectionId = ReadRequestedAiConnectionId(request.aiConnectionId);
  if (request.aiConnectionId && !connectionId)
    return null;
  const options = await BuildAiOptions(store, userId, mediaType, connectionId);
  if (!options)
    return null;
  const friendRatings = await ReadFriendTasteRatings(store, userId, mediaType, request.profile, socialTaste.data);
  return { ...options, friendRatings, tasteAudience: socialTaste.data.audience };
}

async function ReadFriendTasteRatings(store, userId, mediaType, profile, socialTaste) {
  if (socialTaste.audience === MineTasteAudience || typeof store.GetFriendRatings !== FunctionType)
    return [];
  const mediaTypes = ReadTasteMediaTypes(mediaType, profile?.tasteBasis);
  return await store.GetFriendRatings(userId, socialTaste.friendIds, mediaTypes);
}

function ReadTasteMediaTypes(mediaType, tasteBasis) {
  if (tasteBasis === CombinedTasteValue)
    return [MovieMediaType, TelevisionMediaType];
  if (tasteBasis === "other")
    return [mediaType === TelevisionMediaType ? MovieMediaType : TelevisionMediaType];
  return [mediaType];
}

async function BuildAiDraftOptions(store, userId, input) {
  const existing = input.connectionId ? await store.GetAiConnection(userId, input.connectionId) : null;
  if (input.connectionId && !existing)
    return null;
  const baseUrl = ResolveAiBaseUrl(input.providerId, input.baseUrl);
  const submittedKey = NormalizeAiKey(input.apiKey);
  const sameConnection = IsSameAiConnection(existing, input.providerId, baseUrl);
  const savedKey = sameConnection ? await store.ReadAiConnectionSecret(userId, existing.id) : "";
  const keyMutation = submittedKey || (sameConnection ? undefined : "");
  return { providerId: input.providerId, baseUrl, apiKey: submittedKey || savedKey, keyMutation };
}

function SelectAiConnection(connections, connectionId) {
  if (connectionId)
    return connections.find((connection) => connection.id === connectionId) || null;
  return connections.find((connection) => connection.isDefault) || null;
}

async function BuildSelectedAiOptions(store, userId, connection) {
  if (!connection)
    return { providerId: "", apiKey: "", baseUrl: "", model: "", configured: false };
  const apiKey = await store.ReadAiConnectionSecret(userId, connection.id);
  return {
    providerId: connection.providerId, apiKey, baseUrl: connection.baseUrl,
    model: connection.model, configured: Boolean(connection.model)
  };
}

function ReadRequestedAiConnectionId(value) {
  if (!value)
    return "";
  const parsed = AiConnectionIdSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
}

function IsSameAiConnection(existing, providerId, baseUrl) {
  if (!existing || existing.providerId !== providerId)
    return false;
  return NormalizeUrlKey(existing.baseUrl) === NormalizeUrlKey(baseUrl);
}

function BuildTestedAiConnection(input, tested) {
  return {
    providerId: input.providerId,
    name: input.name || ReadProviderName(input.providerId),
    baseUrl: tested.baseUrl,
    model: tested.model,
    isDefault: Boolean(input.isDefault)
  };
}

function NormalizeUrlKey(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function NormalizeAiKey(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

async function BuildAiConnectionState(store, userId) {
  const connections = (await ReadAiConnections(store, userId)).map(ToPublicAiConnection);
  const defaultConnection = connections.find((connection) => connection.isDefault) || null;
  return {
    ok: true, configured: Boolean(defaultConnection?.model), endpoint: AiRecommendationsPath,
    defaultConnectionId: defaultConnection?.id || "", model: defaultConnection?.model || "",
    hasKey: Boolean(defaultConnection?.hasKey), providers: ListAiProviders(), connections
  };
}

async function ReadAiConnections(store, userId) {
  if (typeof store.ListAiConnections !== FunctionType)
    return [];
  return await store.ListAiConnections(userId);
}

function ToPublicAiConnection(connection) {
  const value = {
    id: connection.id, providerId: connection.providerId, providerName: ReadProviderName(connection.providerId),
    name: connection.name, model: connection.model, isDefault: connection.isDefault,
    hasKey: connection.hasKey, testStatus: connection.testStatus, lastTestedAt: connection.lastTestedAt
  };
  if (IsCustomAiProvider(connection.providerId))
    value.baseUrl = connection.baseUrl;
  return value;
}

async function SendAiConnectionState(response, store, userId, status = 200) {
  response.status(status).json(await BuildAiConnectionState(store, userId));
}

function SendAiModelsResult(response, result) {
  if (!result.payload?.ok)
    return SendResult(response, result);
  response.status(result.status).json({ ok: true, models: result.payload.models });
}

function ReadAiConnectionId(request, response) {
  const parsed = AiConnectionIdSchema.safeParse(request.params.id);
  if (parsed.success)
    return parsed.data;
  Invalid(response);
  return "";
}

function AiConnectionNotFound(response) {
  response.status(404).json({ ok: false, code: "AI_CONNECTION_NOT_FOUND", error: "That AI choice was not found." });
}

function NormalizeSecret(type, value) {
  const cleaned = String(value).replace(/[\r\n]+/g, " ").trim();
  if (type === ImdbSecretType)
    return cleaned.replace(/^cookie\s*:\s*/i, "");
  return cleaned.replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function ReadSecretType(request, response) {
  if (SecretTypes.has(request.params.type))
    return request.params.type;
  response.status(404).json({ ok: false, code: "SECRET_TYPE_UNKNOWN", error: "Unknown credential type." });
  return null;
}

function SendResult(response, result) {
  response.status(result.status).json(result.payload);
}

function Invalid(response) {
  return response.status(422).json({ ok: false, code: "INVALID_REQUEST", error: "The submitted data is invalid." });
}

async function ReadImdbQueueStatus(store, userId) {
  if (typeof store.ReadImdbRatingQueueStatus !== FunctionType)
    return null;
  return await store.ReadImdbRatingQueueStatus(userId);
}

async function ReconcileRaterQueue(store, userId, mediaType, rootPath, readMoviePool, readTitlePool, raterEvents) {
  if (typeof store.getRaterQueue !== FunctionType)
    return null;
  const queue = await store.getRaterQueue(userId, mediaType, await ReadRequestedPool(rootPath, mediaType, readMoviePool, readTitlePool));
  if (queue.changed)
    raterEvents.publish(userId, queue.revision, mediaType);
  return queue;
}

async function ReadRequestedPool(rootPath, mediaType, readMoviePool, readTitlePool) {
  return mediaType === MovieMediaType ? await readMoviePool(rootPath) : await readTitlePool(rootPath, mediaType);
}

async function IsCatalogTitle(rootPath, mediaType, titleId, readMoviePool, readTitlePool) {
  const pool = await ReadRequestedPool(rootPath, mediaType, readMoviePool, readTitlePool);
  return pool.ids.includes(titleId);
}

function UnknownTitle(response) {
  return response.status(404).json({ ok: false, code: "TITLE_NOT_FOUND", error: "The requested title is not in this catalog." });
}

function ReadRequestMediaType(request, response) {
  const raw = request.body?.mediaType ?? request.query?.media ?? MovieMediaType;
  const parsed = MediaTypeSchema.safeParse(raw);
  if (parsed.success)
    return parsed.data;
  Invalid(response);
  return "";
}

function PublicUser(user) {
  return { id: user.id, email: user.email };
}

function SessionUser(request) {
  return { id: request.session.userId, email: request.session.email };
}

function DestroySession(request) {
  return new Promise((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
}

function ReadSessionCookieName() {
  return /^https:/i.test(process.env.APP_ORIGIN || "") ? "__Host-rapid-rater" : "rapid-rater.sid";
}

function IsRegistrationEnabled() {
  return String(process.env.PUBLIC_REGISTRATION_ENABLED ?? "true").toLowerCase() !== "false";
}

function EmailUnavailable(response) {
  return response.status(409).json({ ok: false, code: "EMAIL_UNAVAILABLE", error: "An account already exists for that email address." });
}

function UsernameUnavailable(response) {
  return response.status(409).json({ ok: false, code: "USERNAME_UNAVAILABLE", error: "That username is already in use." });
}
