import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CreateRaterEvents } from "../server/rater-events.mjs";

const CloseEvent = "close";
const RevisionPayload = '"revision":8';
const TvMediaType = "tv";
const UserId = "user-1";

test("queue events are delivered only to listeners in the matching media section", VerifyMediaEventIsolation);

function VerifyMediaEventIsolation() {
  const events = CreateRaterEvents();
  const movie = BuildListener();
  const tv = BuildListener();
  events.subscribe(UserId, movie.request, movie.response, "movie");
  events.subscribe(UserId, tv.request, tv.response, TvMediaType);
  events.publish(UserId, 8, TvMediaType);
  assert.equal(movie.response.writes.some((value) => value.includes(RevisionPayload)), false);
  assert.equal(tv.response.writes.some((value) => value.includes(RevisionPayload) && value.includes('"mediaType":"tv"')), true);
  movie.request.emit(CloseEvent);
  tv.request.emit(CloseEvent);
}

function BuildListener() {
  return { request: new EventEmitter(), response: FakeResponse() };
}

function FakeResponse() {
  return {
    writes: [],
    status() { return this; },
    set() { return this; },
    flushHeaders() {},
    write(value) { this.writes.push(value); }
  };
}
