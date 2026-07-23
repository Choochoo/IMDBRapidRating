import { InitializeRuntimeEnvironment } from "../server/env.mjs";
import { CreateDatabase } from "../server/db/client.mjs";
import { RunMigrations } from "../server/db/migrate.mjs";
import { CreateAccountStore } from "../server/account-store.mjs";
import { HashPassword, RegistrationSchema } from "../server/auth.mjs";
import path from "node:path";

const InputDataEvent = "data";
const Newline = "\n";

process.env.IMDB_RAPID_RATER_HOME ||= path.join(process.cwd(), ".runtime");
await InitializeRuntimeEnvironment(process.cwd());
const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email)
  throw new Error("Usage: npm run user:create -- <email>");
const password = await ReadHiddenPassword("Password (8+ characters): ");
const account = RegistrationSchema.safeParse({ email, password });
if (!account.success)
  throw new Error(account.error.issues[0]?.message || "Enter a valid email address and password.");
const { pool, db } = CreateDatabase();
try {
  await RunMigrations(pool);
  const store = CreateAccountStore({ pool, db });
  if (await store.findUserByEmail(account.data.email))
    throw new Error("An account already exists for that email address.");
  await store.createUser({ email: account.data.email, passwordHash: await HashPassword(account.data.password) });
  console.log(`Created Rapid Rater account: ${account.data.email}`);
} finally {
  await pool.end();
}

function ReadHiddenPassword(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("Account creation must be run from an interactive terminal.");
  process.stdout.write(prompt);
  EnableHiddenInput();
  return new Promise(ConfigureHiddenPassword);
}

function ConfigureHiddenPassword(resolve, reject) {
  const state = { value: "", resolve, reject, onData: null };
  state.onData = (char) => HandleHiddenInput(char, state);
  process.stdin.on(InputDataEvent, state.onData);
}

function EnableHiddenInput() {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function HandleHiddenInput(char, state) {
  if (char === "\r" || char === Newline) {
    FinishHiddenInput(state);
    process.stdout.write(Newline);
    return state.resolve(state.value);
  }
  if (char === "\u0003") {
    FinishHiddenInput(state);
    return state.reject(new Error("Cancelled."));
  }
  if (char === "\u007f" || char === "\b")
    state.value = state.value.slice(0, -1);
  else
    state.value += char;
}

function FinishHiddenInput(state) {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.off(InputDataEvent, state.onData);
}
