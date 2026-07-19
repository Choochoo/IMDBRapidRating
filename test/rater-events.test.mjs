import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CreateRaterEvents } from "../server/rater-events.mjs";

test("queue events are delivered only to listeners in the matching media section", () => {
  const events = CreateRaterEvents();
  const movieRequest = new EventEmitter();
  const tvRequest = new EventEmitter();
  const movieResponse = FakeResponse();
  const tvResponse = FakeResponse();

  events.subscribe("user-1", movieRequest, movieResponse, "movie");
  events.subscribe("user-1", tvRequest, tvResponse, "tv");
  events.publish("user-1", 8, "tv");

  assert.equal(movieResponse.writes.some((value) => value.includes('"revision":8')), false);
  assert.equal(tvResponse.writes.some((value) => value.includes('"revision":8') && value.includes('"mediaType":"tv"')), true);
  movieRequest.emit("close");
  tvRequest.emit("close");
});

function FakeResponse() {
  return {
    writes: [],
    status() { return this; },
    set() { return this; },
    flushHeaders() {},
    write(value) { this.writes.push(value); }
  };
}
