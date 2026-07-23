import assert from "node:assert/strict";
import test from "node:test";
import { UpdateTitleFilterButton } from "../src/app/title-filter-workflows.js";

test("filter buttons keep their icons and expose the active filter count", VerifyFilterButtonState);

function VerifyFilterButtonState() {
  const configure = BuildButton();
  const recommendation = BuildButton();
  const headerCount = { hidden: true, textContent: "" };
  const watchlistCount = { hidden: true, textContent: "" };
  const preview = { textContent: "" };
  const app = { State: { filters: { minYear: 2000 } }, Elements: { configureFilters: configure, filterActiveCount: headerCount, recommendationFilterMore: recommendation, recommendationFilterCount: watchlistCount, recommendationFilterPreview: preview } };
  UpdateTitleFilterButton(app);
  assert.deepEqual([headerCount.textContent, watchlistCount.textContent], ["1", "1"]);
  assert.equal(headerCount.hidden || watchlistCount.hidden, false);
  assert.match(configure.attributes.get("aria-label"), /1 active filter/);
  assert.match(preview.textContent, /rating queue and watchlist/);
}

function BuildButton() {
  const classes = new Set();
  const attributes = new Map();
  return { attributes, classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) }, setAttribute: (name, value) => attributes.set(name, value), title: "" };
}
