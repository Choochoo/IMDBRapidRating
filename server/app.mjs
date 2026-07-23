import { existsSync } from "node:fs";
import path from "node:path";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { CreateAccountStore } from "./account-store.mjs";
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
const AllowedOriginProtocols = Object.freeze(["http:", HttpsSource]);
const FrontendRoutes = Object.freeze([RootRoute, "/login", "/rate", "/wishlist", "/sync", "/friends", "/settings", "/settings/shortcuts", "/settings/ai", "/movies/rate", "/movies/wishlist", "/movies/sync", "/movies/friends", "/tv/rate", "/tv/wishlist", "/tv/friends"]);
const PostgresSessionStore = connectPgSimple(session);

export async function CreateApp(rootPath) {
  const { pool, db } = CreateDatabase();
  await RunMigrations(pool);
  const app = BuildExpressApp(pool);
  const store = CreateAccountStore({ db, pool });
  const raterEvents = CreateRaterEvents();
  const imdbRatingWorker = CreateImdbRatingWorker({ store });
  RegisterApiRoutes(app, { store, pool, rootPath, raterEvents, tmdbApiKey: ReadTmdbApiKey() });
  RegisterStaticRoutes(app, rootPath);
  app.use(HandleAppError);
  await imdbRatingWorker.Start();
  return { app, pool, store, imdbRatingWorker };
}

function ReadTmdbApiKey() {
  return String(process.env.TMDB_API_KEY || "").trim();
}

function BuildExpressApp(pool) {
  const secureCookie = /^https:/i.test(process.env.APP_ORIGIN || "");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use(helmet(BuildHelmetOptions(secureCookie)));
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
  if (["GET", "HEAD", "OPTIONS"].includes(request.method))
    return next();
  const origin = NormalizeOrigin(request.get("origin"));
  if (origin && ReadAllowedOrigins(request).has(origin))
    return next();
  response.status(403).json({ ok: false, code: "ORIGIN_REJECTED", error: "The request origin is not allowed." });
}

export function ReadAllowedOrigins(request) {
  const additionalOrigins = (process.env.APP_ALLOWED_ORIGINS || "").split(",");
  const configured = [`${request.protocol}://${request.get("host")}`, process.env.APP_ORIGIN, ...additionalOrigins];
  const normalized = configured.map((value) => String(value || "").trim());
  const populated = normalized.filter(Boolean);
  return new Set(populated.map(NormalizeOrigin).filter(Boolean));
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

export function BuildHelmetOptions(secureOrigin) {
  return {
    contentSecurityPolicy: {
      directives: BuildContentSecurityDirectives(secureOrigin)
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    ...BuildHttpHelmetOverrides(secureOrigin)
  };
}

function BuildContentSecurityDirectives(secureOrigin) {
  return {
    defaultSrc: [SelfSource],
    imgSrc: [SelfSource, "data:", HttpsSource],
    styleSrc: [SelfSource, "'unsafe-inline'"],
    scriptSrc: [SelfSource],
    connectSrc: [SelfSource],
    "upgrade-insecure-requests": secureOrigin ? [] : null
  };
}

function BuildHttpHelmetOverrides(secureOrigin) {
  if (secureOrigin)
    return {};
  return {
    crossOriginOpenerPolicy: false,
    originAgentCluster: false
  };
}
