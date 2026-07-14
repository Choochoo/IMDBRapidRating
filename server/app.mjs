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

export async function CreateApp(rootPath) {
  const sessionSecret = ReadSessionSecret();
  const { pool, db } = CreateDatabase();
  await RunMigrations(pool);
  const app = express();
  const secureCookie = /^https:/i.test(process.env.APP_ORIGIN || "");
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
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

function RegisterStaticRoutes(app, rootPath) {
  app.use("/src", express.static(path.join(rootPath, "src"), { index: false, maxAge: 0 }));
  app.use("/data", express.static(path.join(rootPath, "data"), { index: false, maxAge: 0 }));
  app.get("/vendor/bootstrap.min.css", (_request, response) => response.sendFile(path.join(rootPath, "node_modules/bootstrap/dist/css/bootstrap.min.css")));
  app.get("/favicon.svg", (_request, response) => response.sendFile(path.join(rootPath, "favicon.svg")));
  app.get("/", (_request, response) => response.sendFile(path.join(rootPath, "index.html")));
}

function VerifyOrigin(request, response, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method))
    return next();
  const origin = request.get("origin");
  const expected = process.env.APP_ORIGIN || `${request.protocol}://${request.get("host")}`;
  if (origin === expected)
    return next();
  response.status(403).json({ ok: false, code: "ORIGIN_REJECTED", error: "The request origin is not allowed." });
}

function ReadSessionSecret() {
  const value = String(process.env.SESSION_SECRET || "");
  if (value.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return value;
}
