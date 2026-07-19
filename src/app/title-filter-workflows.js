import {
  CountActiveTitleFilters,
  IsTitleAllowed,
  NormalizeTitleFilters,
  NormalizeTitleOrigin
} from "../../shared/title-filters.js";
import { FormatCount } from "./util.js";

export function ShowTitleFilterDialog(app) {
  PopulateTitleFilterDialog(app, app.State.filters);
  app.Elements.filtersDialog.hidden = false;
  window.setTimeout(() => app.Elements.filterMinYear.focus(), 0);
}

export function HideTitleFilterDialog(app) {
  app.Elements.filterError.textContent = "";
  app.Elements.filtersDialog.hidden = true;
}

export function ResetTitleFilterDialog(app) {
  PopulateTitleFilterDialog(app, {});
}

export function UpdateTitleFilterPreview(app) {
  const filters = ReadTitleFilterForm(app);
  const titles = Array.isArray(app.State.movies) ? app.State.movies : [];
  const eligible = titles.filter((title) => IsTitleAllowed(title, filters)).length;
  const hidden = Math.max(0, titles.length - eligible);
  app.Elements.filterPreview.textContent = `${FormatCount(eligible)} of ${FormatCount(titles.length)} ${MediaLabel(app, titles.length)} will remain. ${FormatCount(hidden)} will be hidden.`;
  app.Elements.filterError.textContent = ReadYearError(filters, app);
  app.Elements.filtersApply.disabled = Boolean(app.Elements.filterError.textContent);
}

export async function ApplyTitleFilters(app) {
  const filters = ReadTitleFilterForm(app);
  const error = ReadYearError(filters, app);
  if (error) {
    app.Elements.filterError.textContent = error;
    return false;
  }
  const normalized = NormalizeTitleFilters({ ...filters, updatedAt: new Date().toISOString() });
  app.Elements.filtersApply.disabled = true;
  app.Elements.filtersApply.textContent = "Applying...";
  try {
    app.State.filters = normalized;
    app.SaveLocalState();
    await app.FlushStateSync();
    await app.RefreshRaterQueue();
    UpdateTitleFilterButton(app);
    HideTitleFilterDialog(app);
    app.ShowToast(`<strong>Filters applied.</strong> ${app.State.queue.length.toLocaleString()} titles remain in your queue.`);
    return true;
  } finally {
    app.Elements.filtersApply.textContent = "Apply filters";
    app.Elements.filtersApply.disabled = false;
  }
}

export function UpdateTitleFilterButton(app) {
  const count = CountActiveTitleFilters(app.State.filters);
  app.Elements.configureFilters.textContent = count ? `Filters · ${count}` : "Filters";
  app.Elements.configureFilters.classList.toggle("filter-active", count > 0);
  app.Elements.configureFilters.title = count ? `${count} active filter${count === 1 ? "" : "s"}` : "Filter the rating queue";
}

function PopulateTitleFilterDialog(app, value) {
  const filters = NormalizeTitleFilters(value);
  const years = app.State.movies.map((title) => Number(title.year)).filter(Number.isInteger);
  const firstYear = years.length ? Math.min(...years) : 1870;
  const lastYear = years.length ? Math.max(...years) : 2200;
  const isTv = app.State.mediaType === "tv";
  app.Elements.filtersTitle.textContent = `${isTv ? "TV show" : "Movie"} filters`;
  app.Elements.filtersDescription.textContent = `Choose which ${isTv ? "premiere" : "release"} years and production origins stay in your rating queue. Filtered titles are not marked as ${isTv ? "not watched" : "not seen"} and return if you remove a filter.`;
  app.Elements.filterMinYear.min = String(firstYear);
  app.Elements.filterMinYear.max = String(lastYear);
  app.Elements.filterMinYear.placeholder = String(firstYear);
  app.Elements.filterMinYear.value = filters.minYear || "";
  app.Elements.filterMaxYear.min = String(firstYear);
  app.Elements.filterMaxYear.max = String(lastYear);
  app.Elements.filterMaxYear.placeholder = String(lastYear);
  app.Elements.filterMaxYear.value = filters.maxYear || "";
  app.Elements.filterBollywood.checked = filters.excludeBollywood;
  app.Elements.filterIncludeUnknown.checked = filters.includeUnknownOrigin;
  RenderOriginOptions(app, filters);
  app.Elements.filterError.textContent = "";
  UpdateTitleFilterPreview(app);
}

function RenderOriginOptions(app, filters) {
  const countries = new Map();
  const languages = new Map();
  let known = 0;
  for (const title of app.State.movies) {
    const origin = NormalizeTitleOrigin(title);
    if (origin.originCountries.length || origin.originalLanguage)
      known++;
    for (const country of origin.originCountries)
      countries.set(country, (countries.get(country) || 0) + 1);
    if (origin.originalLanguage)
      languages.set(origin.originalLanguage, (languages.get(origin.originalLanguage) || 0) + 1);
  }
  for (const country of filters.excludedOriginCountries)
    if (!countries.has(country))
      countries.set(country, 0);
  for (const language of filters.excludedOriginalLanguages)
    if (!languages.has(language))
      languages.set(language, 0);
  RenderOptionList(app.Elements.filterCountryOptions, countries, filters.excludedOriginCountries, "country");
  RenderOptionList(app.Elements.filterLanguageOptions, languages, filters.excludedOriginalLanguages, "language");
  app.Elements.filterOriginNote.textContent = known
    ? `Origin metadata is available for ${FormatCount(known)} of ${FormatCount(app.State.movies.length)} titles. Unknown titles remain included unless you turn that option off.`
    : "This catalog has not been enriched with origin metadata yet. Year filtering works now; country and language choices will appear after the TMDB origin build runs.";
  app.Elements.filterBollywood.disabled = !countries.has("IN") || !languages.has("hi");
}

function RenderOptionList(container, counts, selected, type) {
  container.replaceChildren();
  if (!counts.size) {
    const empty = document.createElement("span");
    empty.className = "filter-options-empty";
    empty.textContent = "No origin metadata available.";
    container.append(empty);
    return;
  }
  const names = DisplayNames(type);
  const options = [...counts.entries()]
    .map(([code, count]) => ({ code, count, name: ReadDisplayName(names, code) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const option of options)
    container.append(BuildOption(option, selected.includes(option.code), type));
}

function BuildOption(option, checked, type) {
  const label = document.createElement("label");
  label.className = "filter-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.dataset[type === "country" ? "filterCountry" : "filterLanguage"] = option.code;
  const name = document.createElement("span");
  name.textContent = option.name;
  const count = document.createElement("small");
  count.textContent = FormatCount(option.count);
  label.append(input, name, count);
  return label;
}

function ReadTitleFilterForm(app) {
  return NormalizeTitleFilters({
    minYear: app.Elements.filterMinYear.value,
    maxYear: app.Elements.filterMaxYear.value,
    excludedOriginCountries: ReadCheckedCodes(app.Elements.filterCountryOptions, "filterCountry"),
    excludedOriginalLanguages: ReadCheckedCodes(app.Elements.filterLanguageOptions, "filterLanguage"),
    excludeBollywood: app.Elements.filterBollywood.checked,
    includeUnknownOrigin: app.Elements.filterIncludeUnknown.checked
  });
}

function ReadCheckedCodes(container, key) {
  return [...container.querySelectorAll(`input[data-${ToDataAttribute(key)}]:checked`)].map((input) => input.dataset[key]);
}

function ToDataAttribute(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function ReadYearError(filters, app) {
  const min = Number(app.Elements.filterMinYear.value);
  const max = Number(app.Elements.filterMaxYear.value);
  if (app.Elements.filterMinYear.value && !filters.minYear)
    return "Enter a valid starting year.";
  if (app.Elements.filterMaxYear.value && !filters.maxYear)
    return "Enter a valid ending year.";
  if (min && max && min > max)
    return "The starting year must be before the ending year.";
  return "";
}

function DisplayNames(type) {
  try {
    return new Intl.DisplayNames([globalThis.navigator?.language || "en"], { type: type === "country" ? "region" : "language" });
  } catch {
    return { of: (value) => value.toUpperCase() };
  }
}

function ReadDisplayName(names, code) {
  try {
    return names.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function MediaLabel(app, count) {
  if (app.State.mediaType === "tv")
    return count === 1 ? "show" : "shows";
  return count === 1 ? "movie" : "movies";
}
