import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import test from "node:test";
import { RegisterStaticRoutes } from "../server/app.mjs";

test("browser module graph can load the shared CSV helper", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/shared/csv.js").expect(200);
  assert.match(response.text, /export function ParseCsv/);
  assert.match(response.headers["content-type"], /javascript/);
});
