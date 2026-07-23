import assert from "node:assert/strict";
import test from "node:test";
import { ApplyAccountSettings } from "../src/app/browser-settings.js";
import { DefaultStreamingCountry, NormalizeStreamingCountry, ReadStreamingCountry } from "../shared/streaming-country.js";

const InvalidCountry = "Canada";

test("streaming country codes normalize and invalid values use the default", VerifyCountryNormalization);
test("account settings retain the saved streaming country", VerifySavedCountry);

function VerifyCountryNormalization() {
  assert.equal(NormalizeStreamingCountry(" ca "), "CA");
  assert.equal(NormalizeStreamingCountry(InvalidCountry), "");
  assert.equal(ReadStreamingCountry(InvalidCountry), DefaultStreamingCountry);
}

function VerifySavedCountry() {
  const settings = ApplyAccountSettings({}, { streamingCountry: "gb" });
  assert.equal(settings.streamingCountry, "GB");
}
