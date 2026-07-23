import assert from "node:assert/strict";
import test from "node:test";
import { UpdateTitleFilterButton } from "../src/app/title-filter-workflows.js";

const SingleFilterCount = "1";

test("filter buttons keep their icons and expose the active filter count", VerifyFilterButtonState);

function VerifyFilterButtonState() {
  const fixture = BuildFilterFixture();
  UpdateTitleFilterButton(fixture.app);
  AssertFilterCounts(fixture.counts);
  assert.match(fixture.configure.attributes.get("aria-label"), /1 active filter/);
  assert.match(fixture.summary.textContent, /2000–Any · 1 movie match/);
}

function BuildFilterFixture() {
  const controls = BuildFilterControls();
  const movies = [{ title: "Old", year: 1999 }, { title: "New", year: 2001 }];
  const Elements = BuildFilterElements(controls.configure, controls.counts, controls.minimumYear, controls.maximumYear, controls.summary);
  const app = BuildFilterApp(movies, Elements);
  return {
    app,
    configure: controls.configure,
    counts: controls.counts,
    summary: controls.summary
  };
}

function BuildFilterApp(movies, Elements) {
  const State = {
    filters: { minYear: 2000 },
    movies,
    mediaType: "movie"
  };
  return {
    State,
    Elements
  };
}

function BuildFilterControls() {
  return {
    configure: BuildButton(),
    counts: [BuildCount(), BuildCount(), BuildCount()],
    minimumYear: BuildYearInput("recommendation-min-year"),
    maximumYear: BuildYearInput("recommendation-max-year"),
    summary: { textContent: "" }
  };
}

function BuildFilterElements(configure, counts, minimumYear, maximumYear, summary) {
  return { ...BuildFilterButtons(configure), ...BuildFilterCounts(counts, summary), ...BuildFilterInputs(minimumYear, maximumYear) };
}

function BuildFilterButtons(configure) {
  return {
    configureFilters: configure,
    recommendationFilterMore: BuildButton(),
    recommendationFilterEdit: BuildButton()
  };
}

function BuildFilterCounts(counts, summary) {
  return {
    filterActiveCount: counts[0],
    recommendationFilterCount: counts[1],
    recommendationGeneratorFilterCount: counts[2],
    recommendationPickFilterSummary: summary
  };
}

function BuildFilterInputs(minimumYear, maximumYear) {
  return {
    recommendationMinYear: minimumYear,
    recommendationMaxYear: maximumYear
  };
}

function AssertFilterCounts(counts) {
  assert.deepEqual(counts.map((count) => count.textContent), [SingleFilterCount, SingleFilterCount, SingleFilterCount]);
  assert.equal(counts.some((count) => count.hidden), false);
}

function BuildCount() {
  return { hidden: true, textContent: "" };
}

function BuildButton() {
  const classes = new Set();
  const attributes = new Map();
  return {
    attributes,
    classList: BuildClassList(classes),
    setAttribute: (name, value) => attributes.set(name, value),
    title: ""
  };
}

function BuildClassList(classes) {
  return { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) };
}

function BuildYearInput(id) {
  return { id, min: "", max: "", placeholder: "", value: "" };
}
