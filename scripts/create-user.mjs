import { LoadLocalEnv } from "../server/env.mjs";
import { CreateDatabase } from "../server/db/client.mjs";
import { RunMigrations } from "../server/db/migrate.mjs";
import { CreateAccountStore } from "../server/account-store.mjs";
import { HashPassword } from "../server/auth.mjs";
import path from "node:path";

process.env.IMDB_RAPID_RATER_HOME ||= path.join(process.cwd(), ".runtime");
LoadLocalEnv(process.cwd());
const username = String(process.argv[2] || "").trim().toLowerCase();
const displayName = String(process.argv[3] || username).trim();
if (!username)
  throw new Error("Usage: npm run user:create -- <username> [display name]");
const password = await ReadHiddenPassword("Password (8+ characters): ");
const { pool, db } = CreateDatabase();
try {
  await RunMigrations(pool);
  const store = CreateAccountStore({ pool, db });
  if (await store.findUserByUsername(username))
    throw new Error("That username already exists.");
  await store.createUser({ username, displayName, passwordHash: await HashPassword(password) });
  console.log(`Created Rapid Rater account: ${username}`);
} finally {
  await pool.end();
}

function ReadHiddenPassword(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("Account creation must be run from an interactive terminal.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        Cleanup();
        process.stdout.write("\n");
        return resolve(value);
      }
      if (char === "\u0003") {
        Cleanup();
        return reject(new Error("Cancelled."));
      }
      if (char === "\u007f" || char === "\b")
        value = value.slice(0, -1);
      else
        value += char;
    };
    const Cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };
    process.stdin.on("data", onData);
  });
}
