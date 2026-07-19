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

const BuiltInAllowedOrigins = [
  "http://ourfilmclub.duckdns.org",
  "http://ourfilmclub.duckdns.org:5012"
];

export async function CreateApp(rootPath) {
  const sessionSecret = ReadSessionSecret();
  const { pool, db } = CreateDatabase();
  await RunMigrations(pool);
  const app = express();
  const secureCookie = /^https:/i.test(process.env.APP_ORIGIN || "");
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use(helmet(BuildHelmetOptions(secureCookie)));
  app.use(express.json({ limit: "12mb", type: "application/json" }));
  const PgStore = connectPgSimple(session);
  app.use(session({
    name: secureCookie ? "__Host-rapid-rater" : "rapid-rater.sid",
    secret: sessionSecret,
    store: new PgStore({ pool, schemaName: ReadDatabaseSchema(), tableName: "user_sessions" }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 * 1000 }
  }));
  app.use(VerifyOrigin);
  const store = CreateAccountStore({ db, pool });
  RegisterApiRoutes(app, { store, pool, rootPath });
  RegisterStaticRoutes(app, rootPath);
  app.use((error, request, response, _next) => {
    console.error(`${request.method} ${request.path} failed:`, error.message);
    response.status(500).json({ ok: false, code: "SERVER_ERROR", error: "The server could not complete the request." });
  });
  return { app, pool, store };
}

export function RegisterStaticRoutes(app, rootPath) {
  app.use("/src", express.static(path.join(rootPath, "src"), { index: false, maxAge: 0 }));
  app.use("/data", express.static(path.join(rootPath, "data"), { index: false, maxAge: 0 }));
  app.get("/shared/csv.js", (_request, response) => response.sendFile(path.join(rootPath, "shared/csv.js")));
  app.get("/vendor/bootstrap.min.css", (_request, response) => response.sendFile(path.join(rootPath, "node_modules/bootstrap/dist/css/bootstrap.min.css")));
  app.get("/vendor/fflate.js", (_request, response) => response.sendFile(path.join(rootPath, "node_modules/fflate/esm/browser.js")));
  app.get("/favicon.svg", (_request, response) => response.sendFile(path.join(rootPath, "favicon.svg")));
  app.get(["/", "/rate", "/wishlist", "/sync"], (request, response) => {
    if (request.path !== "/" && request.path.endsWith("/"))
      return response.redirect(308, request.path.replace(/\/+$/, ""));
    response.sendFile(path.join(rootPath, "index.html"));
  });
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
  const configured = [process.env.APP_ORIGIN, ...(process.env.APP_ALLOWED_ORIGINS || "").split(","), ...BuiltInAllowedOrigins]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!configured.length)
    configured.push(`${request.protocol}://${request.get("host")}`);
  return new Set(configured.map(NormalizeOrigin).filter(Boolean));
}

function NormalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
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
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        "upgrade-insecure-requests": secureOrigin ? [] : null
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    ...(secureOrigin ? {} : {
      crossOriginOpenerPolicy: false,
      originAgentCluster: false
    })
  };
}
