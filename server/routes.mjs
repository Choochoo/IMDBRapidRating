import { z } from "zod";
import { GenerateAiRecommendations, GetAiStatus } from "./ai-recommendations.mjs";
import { Authenticate, EnsureCsrfToken, HashPassword, LoginLimiter, RegenerateSession, RegistrationLimiter, RegistrationSchema, RequireAuth, RequireCsrf } from "./auth.mjs";
import { GetOpenAiModels } from "./openai-models.mjs";
import { DeleteImdbRating, GetImdbStatus, SubmitImdbRating } from "./imdb-ratings.mjs";
import { GetTitleMetadata } from "./title-metadata.mjs";
import { HasEncryptionKey } from "./security/secrets.mjs";

const StateSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  ratingsCsv: z.string().max(10 * 1024 * 1024).default(""),
  revision: z.number().int().nonnegative()
});
const SecretSchema = z.object({ value: z.string().trim().min(1).max(64 * 1024) });
const PreferencesSchema = z.object({
  openAiModel: z.string().trim().max(160),
  openAiModelLag: z.number().int().min(0).max(20)
});
const SecretTypes = new Set(["imdb", "tmdb", "openai"]);

export function RegisterApiRoutes(app, { store, pool, rootPath }) {
  app.get("/health", async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ ok: true, database: "connected", encryptionConfigured: HasEncryptionKey() });
  });

  app.get("/api/auth/session", async (request, response) => {
    const csrfToken = EnsureCsrfToken(request);
    if (!request.session.userId)
      return response.json({ ok: true, authenticated: false, csrfToken, registrationEnabled: IsRegistrationEnabled() });
    response.json({ ok: true, authenticated: true, csrfToken, registrationEnabled: IsRegistrationEnabled(), user: SessionUser(request) });
  });

  app.post("/api/auth/login", LoginLimiter, RequireCsrf, async (request, response) => {
    const user = await Authenticate(store, request.body);
    if (!user)
      return response.status(401).json({ ok: false, code: "INVALID_LOGIN", error: "The username or password is incorrect." });
    await RegenerateSession(request, user);
    response.json({ ok: true, csrfToken: request.session.csrfToken, user: PublicUser(user) });
  });

  app.post("/api/auth/register", RegistrationLimiter, RequireCsrf, async (request, response) => {
    if (!IsRegistrationEnabled())
      return response.status(403).json({ ok: false, code: "REGISTRATION_DISABLED", error: "New account registration is temporarily unavailable." });
    const parsed = RegistrationSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(422).json({ ok: false, code: "INVALID_REGISTRATION", error: parsed.error.issues[0]?.message || "The account details are invalid." });
    if (await store.findUserByUsername(parsed.data.username))
      return UsernameUnavailable(response);
    try {
      const user = await store.createUser({
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash: await HashPassword(parsed.data.password)
      });
      await RegenerateSession(request, user);
      response.status(201).json({ ok: true, csrfToken: request.session.csrfToken, user: PublicUser(user) });
    } catch (error) {
      if (error?.code === "23505")
        return UsernameUnavailable(response);
      throw error;
    }
  });

  app.post("/api/auth/logout", RequireAuth, RequireCsrf, async (request, response) => {
    await DestroySession(request);
    const secure = /^https:/i.test(process.env.APP_ORIGIN || "");
    response.clearCookie(ReadSessionCookieName(), { path: "/", httpOnly: true, sameSite: "lax", secure });
    response.json({ ok: true });
  });

  app.use("/api", RequireAuth);

  app.get("/api/account/state", async (request, response) => {
    const bundle = await store.getBundle(request.session.userId);
    response.json({ ok: true, user: SessionUser(request), ...BuildBundle(bundle) });
  });

  app.put("/api/account/state", RequireCsrf, async (request, response) => {
    const parsed = StateSchema.safeParse(request.body);
    if (!parsed.success)
      return Invalid(response);
    const result = await store.saveState(request.session.userId, parsed.data.payload, parsed.data.ratingsCsv, parsed.data.revision);
    if (!result.ok)
      return response.status(409).json({ ok: false, code: "STATE_CONFLICT", error: "Your account changed in another browser.", current: result.current });
    response.json({ ok: true, revision: result.revision });
  });

  app.put("/api/account/preferences", RequireCsrf, async (request, response) => {
    const parsed = PreferencesSchema.safeParse(request.body);
    if (!parsed.success)
      return Invalid(response);
    await store.savePreferences(request.session.userId, parsed.data);
    response.json({ ok: true, ...parsed.data });
  });

  app.put("/api/account/secrets/:type", RequireCsrf, async (request, response) => {
    const secretType = ReadSecretType(request, response);
    if (!secretType)
      return;
    const parsed = SecretSchema.safeParse(request.body);
    if (!parsed.success)
      return Invalid(response);
    const value = NormalizeSecret(secretType, parsed.data.value);
    if (secretType === "imdb" && !/(?:^|;\s*)at-main=/.test(value))
      return response.status(422).json({ ok: false, code: "COOKIE_NOT_SIGNED_IN", error: "That IMDb cookie does not include at-main." });
    await store.putSecret(request.session.userId, secretType, value);
    response.json({ ok: true, configured: true });
  });

  app.delete("/api/account/secrets/:type", RequireCsrf, async (request, response) => {
    const secretType = ReadSecretType(request, response);
    if (!secretType)
      return;
    await store.deleteSecret(request.session.userId, secretType);
    response.json({ ok: true, configured: false });
  });

  app.get("/api/imdb/status", async (request, response) => {
    const cookie = await store.getSecret(request.session.userId, "imdb");
    const tmdb = await store.getSecret(request.session.userId, "tmdb");
    response.json({ ...GetImdbStatus(), configured: Boolean(cookie) || GetImdbStatus().dryRun, tmdbConfigured: Boolean(tmdb) });
  });

  app.post("/api/rate", RequireCsrf, async (request, response) => {
    const cookie = await store.getSecret(request.session.userId, "imdb");
    SendResult(response, await SubmitImdbRating(request.body.titleId, request.body.rating, cookie));
  });

  app.delete("/api/rate", RequireCsrf, async (request, response) => {
    const cookie = await store.getSecret(request.session.userId, "imdb");
    SendResult(response, await DeleteImdbRating(request.body.titleId, cookie));
  });

  app.get("/api/ai/status", async (request, response) => {
    const bundle = await store.getBundle(request.session.userId);
    const apiKey = await store.getSecret(request.session.userId, "openai");
    response.json({ ok: true, ...GetAiStatus(), configured: Boolean(apiKey), model: bundle.preferences.openAiModel, modelLag: bundle.preferences.openAiModelLag });
  });

  app.get("/api/ai/models", async (request, response) => {
    const options = await BuildOpenAiOptions(store, request.session.userId);
    SendResult(response, await GetOpenAiModels(options));
  });

  app.post("/api/ai/recommendations", RequireCsrf, async (request, response) => {
    const options = await BuildOpenAiOptions(store, request.session.userId);
    SendResult(response, await GenerateAiRecommendations(rootPath, { ...request.body, ...options }));
  });

  app.get(/^\/api\/title\/(tt\d+)$/, async (request, response) => {
    const tmdbApiKey = await store.getSecret(request.session.userId, "tmdb");
    SendResult(response, await GetTitleMetadata(request.params[0], { tmdbApiKey }));
  });
}

function BuildBundle(bundle) {
  return {
    settings: {
      imdbConfigured: bundle.configured.has("imdb"),
      tmdbConfigured: bundle.configured.has("tmdb"),
      openAiConfigured: bundle.configured.has("openai"),
      openAiModel: bundle.preferences.openAiModel || "",
      openAiModelLag: Number(bundle.preferences.openAiModelLag) || 2
    },
    payload: bundle.state.payload || {},
    ratingsCsv: bundle.state.ratingsCsv || "",
    revision: Number(bundle.state.revision) || 0
  };
}

async function BuildOpenAiOptions(store, userId) {
  const bundle = await store.getBundle(userId);
  return {
    apiKey: await store.getSecret(userId, "openai"),
    model: bundle.preferences.openAiModel,
    modelLag: bundle.preferences.openAiModelLag
  };
}

function NormalizeSecret(type, value) {
  const cleaned = String(value).replace(/[\r\n]+/g, " ").trim();
  if (type === "imdb")
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

function PublicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function SessionUser(request) {
  return { id: request.session.userId, username: request.session.username, displayName: request.session.displayName };
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

function UsernameUnavailable(response) {
  return response.status(409).json({ ok: false, code: "USERNAME_UNAVAILABLE", error: "That username is unavailable. Choose another one." });
}
