import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { SafeTokenEquals } from "./security/secrets.mjs";

const StandardRateLimitHeaders = "draft-8";
const LoginSchemaDefinition = {
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(1024)
};
const LoginSchema = z.object(LoginSchemaDefinition);

const RegistrationSchemaDefinition = {
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254, "Email address is too long."),
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128, "Password cannot exceed 128 characters.")
};
export const RegistrationSchema = z.object(RegistrationSchemaDefinition);

const LoginLimiterOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: StandardRateLimitHeaders,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, code: "LOGIN_RATE_LIMITED", error: "Too many sign-in attempts. Try again later." }
};
export const LoginLimiter = rateLimit(LoginLimiterOptions);

const RegistrationLimiterOptions = {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: StandardRateLimitHeaders,
  legacyHeaders: false,
  message: { ok: false, code: "REGISTRATION_RATE_LIMITED", error: "Too many accounts were created from this connection. Try again later." }
};
export const RegistrationLimiter = rateLimit(RegistrationLimiterOptions);

export function EnsureCsrfToken(request) {
  if (!request.session.csrfToken)
    request.session.csrfToken = randomBytes(32).toString("base64url");
  return request.session.csrfToken;
}

export function RequireCsrf(request, response, next) {
  if (SafeTokenEquals(request.get("x-csrf-token"), request.session.csrfToken))
    return next();
  response.status(403).json({ ok: false, code: "CSRF_REJECTED", error: "The request could not be verified. Refresh and try again." });
}

export function RequireAuth(request, response, next) {
  if (request.session.userId)
    return next();
  response.status(401).json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." });
}

export async function Authenticate(store, body) {
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success)
    return null;
  const user = await store.findUserByEmail(parsed.data.email);
  if (!user || !await argon2.verify(user.passwordHash, parsed.data.password))
    return null;
  return user;
}

export async function HashPassword(password) {
  const parsed = z.string().min(8).max(128).safeParse(password);
  if (!parsed.success)
    throw new Error("Password must contain between 8 and 128 characters.");
  const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
  return await argon2.hash(parsed.data, options);
}

export function RegenerateSession(request, user) {
  return new Promise((resolve, reject) => RegenerateUserSession(request, user, resolve, reject));
}

function RegenerateUserSession(request, user, resolve, reject) {
  request.session.regenerate((error) => CompleteSessionRegeneration(request, user, resolve, reject, error));
}

function CompleteSessionRegeneration(request, user, resolve, reject, error) {
  if (error)
    return reject(error);
  request.session.userId = user.id;
  request.session.email = user.email;
  EnsureCsrfToken(request);
  request.session.save((saveError) => saveError ? reject(saveError) : resolve());
}
