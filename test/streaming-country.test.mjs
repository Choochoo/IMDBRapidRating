import assert from "node:assert/strict";
import test from "node:test";
import { ApplyAccountSettings } from "../src/app/browser-settings.js";
import { DefaultStreamingCountry, NormalizeStreamingCountry, ReadStreamingCountry } from "../shared/streaming-country.js";

test("streaming country codes normalize and invalid values use the default", () => {
  assert.equal(NormalizeStreamingCountry(" ca "), "CA");
  assert.equal(NormalizeStreamingCountry("Canada"), "");
  assert.equal(ReadStreamingCountry("Canada"), DefaultStreamingCountry);
});

test("account settings retain the saved streaming country", () => {
  const settings = ApplyAccountSettings({}, { streamingCountry: "gb" });
  assert.equal(settings.streamingCountry, "GB");
});
