import { existsSync } from "node:fs";
import path from "node:path";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { CreateAccountStore } from "./account-store.mjs";
import { ReadAnalyticsOrigin, ReadPublicAnalyticsConfig } from "./analytics-config.mjs";
import { CreateDatabase } from "./db/client.mjs";
import { ReadDatabaseSchema } from "./db/config.mjs";
import { RunMigrations } from "./db/migrate.mjs";
import { RegisterApiRoutes } from "./routes.mjs";
import { CreateRaterEvents } from "./rater-events.mjs";
import { CreateImdbRatingWorker } from "./imdb-rating-worker.mjs";

const ProductionEnvironment = "production";
const DistributionDirectory = "dist";
const IndexFileName = "index.html";
const HttpsSource = "https:";
const SelfSource = "'self'";
const RootRoute = "/";
const ProductionBrowserOrigins = Object.freeze(["https://rapidrater.io", "https://www.rapidrater.io"]);
const AllowedOriginProtocols = Object.freeze(["http:", HttpsSource]);
const CorsAllowedHeaders = "Content-Type, X-CSRF-Token";
const CorsAllowedMethods = "GET, HEAD, POST, PUT, DELETE, OPTIONS";
const OriginHeader = "origin";
const OptionsMethod = "OPTIONS";
const SafeOriginMethods = Object.freeze(["GET", "HEAD", OptionsMethod]);
const FrontendRoutes = Object.freeze([RootRoute, "/login", "/rate", "/wishlist", "/sync", "/friends", "/settings", "/settings/shortcuts", "/settings/ai", "/movies/rate", "/movies/wishlist", "/movies/sync", "/movies/friends", "/tv/rate", "/tv/wishlist", "/tv/friends"]);
const PostgresSessionStore = connectPgSimple(session);

export async function CreateApp(rootPath) {
  const { pool, db } = CreateDatabase();
  await RunMigrations(pool);
  const analyticsConfig = ReadPublicAnalyticsConfig();
  const app = BuildExpressApp(pool, ReadAnalyticsOrigin(analyticsConfig));
  const store = CreateAccountStore({ db, pool });
  await store.MigrateLegacyAiConnectionSecrets();
  await store.FinalizeAiConnectionMigration();
  const raterEvents = CreateRaterEvents();
  const imdbRatingWorker = CreateImdbRatingWorker({ store });
  RegisterApiRoutes(app, { store, pool, rootPath, raterEvents, analyticsConfig, tmdbApiKey: ReadTmdbApiKey() });
  RegisterFinalRoutes(app, rootPath);
  await imdbRatingWorker.Start();
  return { app, pool, store, imdbRatingWorker };
}

function RegisterFinalRoutes(app, rootPath) {
  RegisterStaticRoutes(app, rootPath);
  app.use(HandleAppError);
}

function ReadTmdbApiKey() {
  return String(process.env.TMDB_API_KEY || "").trim();
}

function BuildExpressApp(pool, analyticsOrigin) {
  const secureCookie = /^https:/i.test(process.env.APP_ORIGIN || "");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use(helmet(BuildHelmetOptions(secureCookie, analyticsOrigin)));
  app.use(ApplyCorsPolicy);
  app.use(express.json({ limit: "12mb", type: "application/json" }));
  app.use(session(BuildSessionOptions(pool, secureCookie)));
  app.use(VerifyOrigin);
  return app;
}

function BuildSessionOptions(pool, secureCookie) {
  return {
    name: secureCookie ? "__Host-rapid-rater" : "rapid-rater.sid",
    secret: ReadSessionSecret(),
    store: new PostgresSessionStore({ pool, schemaName: ReadDatabaseSchema(), tableName: "user_sessions" }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: secureCookie, sameSite: "lax", path: RootRoute, maxAge: 30 * 24 * 60 * 60 * 1000 }
  };
}

function HandleAppError(error, request, response, _next) {
  console.error(`${request.method} ${request.path} failed:`, error.message);
  response.status(500).json({ ok: false, code: "SERVER_ERROR", error: "The server could not complete the request." });
}

export function RegisterStaticRoutes(app, rootPath) {
  const builtIndex = path.join(rootPath, DistributionDirectory, IndexFileName);
  const useBuiltClient = process.env.NODE_ENV === ProductionEnvironment && existsSync(builtIndex);
  const indexPath = useBuiltClient ? builtIndex : path.join(rootPath, IndexFileName);
  app.use("/assets", express.static(path.join(rootPath, DistributionDirectory, "assets"), { index: false, immutable: true, maxAge: "1y" }));
  app.use("/src", express.static(path.join(rootPath, "src"), { index: false, maxAge: 0 }));
  app.use("/data", express.static(path.join(rootPath, "data"), { index: false, maxAge: 0 }));
  RegisterSharedRoutes(app, rootPath);
  app.get(FrontendRoutes, BuildClientPageHandler(indexPath));
}

function RegisterSharedRoutes(app, rootPath) {
  app.get("/shared/csv.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/csv.js")));
  app.get("/shared/media.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/media.js")));
  app.get("/shared/recommendation-basis.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/recommendation-basis.js")));
  app.get("/shared/keyboard-shortcuts.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/keyboard-shortcuts.js")));
  app.get("/shared/title-filters.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/title-filters.js")));
  app.get("/vendor/bootstrap.min.css", (_request, response) => response.sendFile(path.join(rootPath, "node_modules/bootstrap/dist/css/bootstrap.min.css")));
  app.get("/vendor/fflate.js", (_request, response) => response.sendFile(path.join(rootPath, "node_modules/fflate/esm/browser.js")));
  app.get("/favicon.svg", (_request, response) => response.sendFile(path.join(rootPath, "favicon.svg")));
}

function BuildClientPageHandler(indexPath) {
  return (request, response) => {
    if (request.path !== RootRoute && request.path.endsWith(RootRoute))
      return response.redirect(308, request.path.replace(/\/+$/, ""));
    response.sendFile(indexPath);
  };
}

export function VerifyOrigin(request, response, next) {
  if (SafeOriginMethods.includes(request.method))
    return next();
  const origin = NormalizeOrigin(request.get(OriginHeader));
  if (origin && ReadAllowedOrigins(request).has(origin))
    return next();
  return RejectOrigin(response);
}

export function ApplyCorsPolicy(request, response, next) {
  response.vary(OriginHeader);
  const origin = NormalizeOrigin(request.get(OriginHeader));
  if (!origin)
    return next();
  if (!ReadAllowedOrigins(request).has(origin))
    return RejectOrigin(response);
  response.set(BuildCorsHeaders(origin));
  if (request.method === OptionsMethod)
    return response.sendStatus(204);
  return next();
}

export function ReadAllowedOrigins(request) {
  if (process.env.NODE_ENV === ProductionEnvironment)
    return new Set(ProductionBrowserOrigins);
  const additionalOrigins = (process.env.APP_ALLOWED_ORIGINS || "").split(",");
  const configured = [`${request.protocol}://${request.get("host")}`, process.env.APP_ORIGIN, ...additionalOrigins];
  const normalized = configured.map((value) => String(value || "").trim());
  const populated = normalized.filter(Boolean);
  return new Set(populated.map(NormalizeOrigin).filter(Boolean));
}

function BuildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": CorsAllowedHeaders,
    "Access-Control-Allow-Methods": CorsAllowedMethods,
    "Access-Control-Allow-Origin": origin
  };
}

function RejectOrigin(response) {
  return response.status(403).json({ ok: false, code: "ORIGIN_REJECTED", error: "The request origin is not allowed." });
}

function NormalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (!AllowedOriginProtocols.includes(url.protocol))
      return "";
    return url.origin;
  } catch {
    return "";
  }
}

function ReadSessionSecret() {
  const value = String(process.env.SESSION_SECRET || "");
  if (value.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return value;
}

export function BuildHelmetOptions(secureOrigin, analyticsOrigin = "") {
  return {
    contentSecurityPolicy: {
      directives: BuildContentSecurityDirectives(secureOrigin, analyticsOrigin)
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    ...BuildHttpHelmetOverrides(secureOrigin)
  };
}

function BuildContentSecurityDirectives(secureOrigin, analyticsOrigin) {
  return {
    defaultSrc: [SelfSource],
    imgSrc: [SelfSource, "data:", HttpsSource],
    styleSrc: [SelfSource, "'unsafe-inline'"],
    scriptSrc: [SelfSource],
    connectSrc: BuildConnectSources(analyticsOrigin),
    "upgrade-insecure-requests": secureOrigin ? [] : null
  };
}

function BuildConnectSources(analyticsOrigin) {
  if (!analyticsOrigin)
    return [SelfSource];
  return [SelfSource, analyticsOrigin];
}

function BuildHttpHelmetOverrides(secureOrigin) {
  if (secureOrigin)
    return {};
  return {
    crossOriginOpenerPolicy: false,
    originAgentCluster: false
  };
}
