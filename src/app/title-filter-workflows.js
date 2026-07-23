import {
  CountActiveTitleFilters,
  IsTitleAllowed,
  NormalizeTitleFilters,
  NormalizeTitleOrigin
} from "../../shared/title-filters.js";
import { FormatCount } from "./util.js";

const CommonCountries = Object.freeze(["US", "GB", "CA", "AU", "FR", "DE", "ES", "IT", "JP", "KR", "IN", "MX"]);
const CommonLanguages = Object.freeze(["en", "es", "fr", "de", "it", "ja", "ko", "hi", "pt", "zh"]);
const CustomYearPreset = "custom";

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
  const counts = CountFilterMatches(app, filters);
  app.Elements.filterPreview.textContent = BuildDialogPreview(app, counts);
  app.Elements.filterError.textContent = ReadYearError(filters, app);
  app.Elements.filtersApply.disabled = Boolean(app.Elements.filterError.textContent);
}

export function UpdateRecommendationFilterPreview(app) {
  const filters = ReadRecommendationFilterForm(app);
  const counts = CountFilterMatches(app, filters);
  app.Elements.recommendationFilterPreview.textContent = BuildRecommendationPreview(app, counts);
}

export async function ApplyTitleFilters(app) {
  const filters = ReadTitleFilterForm(app);
  const error = ReadYearError(filters, app);
  if (error)
    return ShowTitleFilterValidation(app, error);
  return await SaveTitleFilters(app, filters, true);
}

export async function ApplyRecommendationFilters(app) {
  const filters = ReadRecommendationFilterForm(app);
  return await SaveTitleFilters(app, filters, false);
}

export async function ClearRecommendationFilters(app) {
  PopulateRecommendationFilterExplorer(app, {});
  return await SaveTitleFilters(app, NormalizeTitleFilters(), false);
}

export function UpdateTitleFilterButton(app) {
  const count = CountActiveTitleFilters(app.State.filters);
  app.Elements.configureFilters.textContent = count ? `Filters · ${count}` : "Filters";
  app.Elements.configureFilters.classList.toggle("filter-active", count > 0);
  app.Elements.configureFilters.title = count ? `${count} active filter${count === 1 ? "" : "s"}` : "Filter ratings and recommendations";
  PopulateRecommendationFilterExplorer(app, app.State.filters);
}

function ShowTitleFilterValidation(app, error) {
  app.Elements.filterError.textContent = error;
  return false;
}

async function SaveTitleFilters(app, filters, hideDialog) {
  SetFilterSaving(app, true);
  try {
    await PersistTitleFilters(app, filters);
    CompleteTitleFilterApply(app, hideDialog);
    return true;
  } finally {
    SetFilterSaving(app, false);
  }
}

async function PersistTitleFilters(app, filters) {
  app.State.filters = NormalizeTitleFilters({ ...filters, updatedAt: new Date().toISOString() });
  app.SaveLocalState();
  await app.FlushStateSync();
  await app.RefreshRaterQueue();
}

function CompleteTitleFilterApply(app, hideDialog) {
  UpdateTitleFilterButton(app);
  app.RenderRecommendationQueue();
  app.UpdateRecommendationStatus();
  if (hideDialog)
    HideTitleFilterDialog(app);
  const count = CountFilterMatches(app, app.State.filters).catalog;
  app.ShowToast(`<strong>Filters applied.</strong> ${FormatCount(count)} catalog titles can be recommended.`);
}

function SetFilterSaving(app, value) {
  app.Elements.filtersApply.disabled = value;
  app.Elements.filtersApply.textContent = value ? "Applying..." : "Apply filters";
  app.Elements.recommendationFilterApply.disabled = value;
  app.Elements.recommendationFilterApply.textContent = value ? "Applying..." : "Apply to picks";
  app.Elements.recommendationFilterClear.disabled = value;
}

function PopulateTitleFilterDialog(app, value) {
  const filters = NormalizeTitleFilters(value);
  PopulateDialogCopy(app);
  PopulateDialogYears(app, filters);
  PopulateDialogCatalogFields(app, filters);
  RenderDialogOptions(app, filters);
  app.Elements.filterError.textContent = "";
  UpdateTitleFilterPreview(app);
}

function PopulateDialogCopy(app) {
  const isTv = app.State.mediaType === "tv";
  app.Elements.filtersTitle.textContent = `${isTv ? "TV show" : "Movie"} filters`;
  app.Elements.filtersDescription.textContent = `Choose exactly what can appear in ${isTv ? "show" : "movie"} recommendations and the rating queue. Saved watchlist titles outside the filter stay saved.`;
}

function PopulateDialogYears(app, filters) {
  const [firstYear, lastYear] = ReadCatalogYearRange(app.State.movies);
  SetYearInput(app.Elements.filterMinYear, firstYear, lastYear, filters.minYear);
  SetYearInput(app.Elements.filterMaxYear, firstYear, lastYear, filters.maxYear);
}

function SetYearInput(input, firstYear, lastYear, value) {
  input.min = String(firstYear);
  input.max = String(lastYear);
  input.placeholder = String(input.id.includes("min") ? firstYear : lastYear);
  input.value = value || "";
}

function PopulateDialogCatalogFields(app, filters) {
  app.Elements.filterDocumentaryMode.value = filters.documentaryMode;
  app.Elements.filterMinRating.value = filters.minImdbRating || "";
  app.Elements.filterMaxRuntime.value = filters.maxRuntimeMinutes || "";
  app.Elements.filterBollywood.checked = filters.excludeBollywood;
  app.Elements.filterIncludeUnknown.checked = filters.includeUnknownOrigin;
}

function RenderDialogOptions(app, filters) {
  const counts = ReadCatalogOptionCounts(app.State.movies);
  SeedOptions(counts.countries, CommonCountries);
  SeedOptions(counts.languages, CommonLanguages);
  RenderOptionList(app.Elements.filterGenreOptions, counts.genres, filters.includedGenres, "genre");
  RenderOptionList(app.Elements.filterCountryOptions, counts.countries, filters.includedOriginCountries, "country");
  RenderOptionList(app.Elements.filterLanguageOptions, counts.languages, filters.includedOriginalLanguages, "language");
  UpdateOriginNote(app, counts.knownOrigins);
}

function UpdateOriginNote(app, known) {
  const total = app.State.movies.length;
  app.Elements.filterOriginNote.textContent = known
    ? `Verified origin metadata is available for ${FormatCount(known)} of ${FormatCount(total)} titles. A selected language or country never admits an unknown match.`
    : "Language and country filters are strict. Titles without verified origin metadata will not match a selected language or country.";
  app.Elements.filterBollywood.disabled = false;
}

function PopulateRecommendationFilterExplorer(app, value) {
  const filters = NormalizeTitleFilters(value);
  PopulateRecommendationSelects(app, filters);
  RenderRecommendationOptions(app, filters);
  UpdateRecommendationFilterPreview(app);
}

function PopulateRecommendationSelects(app, filters) {
  app.Elements.recommendationFilterYear.value = ReadYearPreset(filters);
  app.Elements.recommendationFilterDocumentary.value = filters.documentaryMode;
  app.Elements.recommendationFilterRating.value = filters.minImdbRating || "";
  app.Elements.recommendationFilterRuntime.value = filters.maxRuntimeMinutes || "";
}

function RenderRecommendationOptions(app, filters) {
  const counts = ReadCatalogOptionCounts(app.State.movies);
  SeedOptions(counts.languages, CommonLanguages);
  RenderChipList(app.Elements.recommendationFilterGenres, counts.genres, filters.includedGenres, "genre");
  RenderChipList(app.Elements.recommendationFilterLanguages, counts.languages, filters.includedOriginalLanguages, "language");
}

function RenderOptionList(container, counts, selected, type) {
  container.replaceChildren();
  const options = BuildOptions(counts, type);
  for (const option of options)
    container.append(BuildOption(option, selected.includes(option.code), type));
}

function RenderChipList(container, counts, selected, type) {
  container.replaceChildren();
  const options = BuildOptions(counts, type);
  for (const option of options)
    container.append(BuildChipOption(option, selected.includes(option.code), type));
}

function BuildOptions(counts, type) {
  const names = type === "genre" ? null : DisplayNames(type);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count, name: ReadOptionName(names, code) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function BuildOption(option, checked, type) {
  const label = document.createElement("label");
  label.className = "filter-option form-check";
  const input = BuildCheckbox(option.code, checked, `filter${Capitalize(type)}`);
  const name = document.createElement("span");
  name.textContent = option.name;
  const count = document.createElement("small");
  count.textContent = FormatCount(option.count);
  label.append(input, name, count);
  return label;
}

function BuildChipOption(option, checked, type) {
  const label = document.createElement("label");
  label.className = "recommendation-filter-chip";
  const input = BuildCheckbox(option.code, checked, `recommendationFilter${Capitalize(type)}`);
  const text = document.createElement("span");
  text.textContent = option.name;
  label.title = option.count ? `${FormatCount(option.count)} catalog matches` : "Origin verified when recommendations are generated";
  label.append(input, text);
  return label;
}

function BuildCheckbox(code, checked, dataKey) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.checked = checked;
  input.dataset[dataKey] = code;
  return input;
}

function ReadTitleFilterForm(app) {
  return NormalizeTitleFilters({
    minYear: app.Elements.filterMinYear.value,
    maxYear: app.Elements.filterMaxYear.value,
    includedGenres: ReadCheckedCodes(app.Elements.filterGenreOptions, "filterGenre"),
    documentaryMode: app.Elements.filterDocumentaryMode.value,
    minImdbRating: app.Elements.filterMinRating.value,
    maxRuntimeMinutes: app.Elements.filterMaxRuntime.value,
    includedOriginCountries: ReadCheckedCodes(app.Elements.filterCountryOptions, "filterCountry"),
    includedOriginalLanguages: ReadCheckedCodes(app.Elements.filterLanguageOptions, "filterLanguage"),
    excludeBollywood: app.Elements.filterBollywood.checked,
    includeUnknownOrigin: app.Elements.filterIncludeUnknown.checked
  });
}

function ReadRecommendationFilterForm(app) {
  const current = NormalizeTitleFilters(app.State.filters);
  return NormalizeTitleFilters({
    ...current,
    ...ReadYearPresetRange(app.Elements.recommendationFilterYear.value, current),
    includedGenres: ReadCheckedCodes(app.Elements.recommendationFilterGenres, "recommendationFilterGenre"),
    documentaryMode: app.Elements.recommendationFilterDocumentary.value,
    minImdbRating: app.Elements.recommendationFilterRating.value,
    maxRuntimeMinutes: app.Elements.recommendationFilterRuntime.value,
    includedOriginalLanguages: ReadCheckedCodes(app.Elements.recommendationFilterLanguages, "recommendationFilterLanguage")
  });
}

function ReadCheckedCodes(container, key) {
  const attribute = ToDataAttribute(key);
  return [...container.querySelectorAll(`input[data-${attribute}]:checked`)].map((input) => input.dataset[key]);
}

function ReadYearPreset(filters) {
  if (!filters.minYear && !filters.maxYear)
    return "any";
  if (!filters.minYear && filters.maxYear === 1989)
    return "classics";
  const decade = Math.floor(filters.minYear / 10) * 10;
  return filters.minYear === decade && filters.maxYear === decade + 9 ? `${decade}s` : CustomYearPreset;
}

function ReadYearPresetRange(value, current) {
  if (value === CustomYearPreset)
    return { minYear: current.minYear, maxYear: current.maxYear };
  if (value === "classics")
    return { minYear: null, maxYear: 1989 };
  if (value === "any")
    return { minYear: null, maxYear: null };
  const minYear = Number(value.replace("s", ""));
  return { minYear, maxYear: minYear + 9 };
}

function ReadCatalogOptionCounts(titles) {
  const counts = { genres: new Map(), countries: new Map(), languages: new Map(), knownOrigins: 0 };
  for (const title of titles)
    CountTitleOptions(title, counts);
  return counts;
}

function CountTitleOptions(title, counts) {
  for (const genre of Array.isArray(title.genres) ? title.genres : [])
    AddOptionCount(counts.genres, genre);
  const origin = NormalizeTitleOrigin(title);
  for (const country of origin.originCountries)
    AddOptionCount(counts.countries, country);
  if (origin.originalLanguage)
    AddOptionCount(counts.languages, origin.originalLanguage);
  if (origin.originCountries.length || origin.originalLanguage)
    counts.knownOrigins++;
}

function AddOptionCount(counts, value) {
  if (!value)
    return;
  counts.set(value, (counts.get(value) || 0) + 1);
}

function SeedOptions(counts, values) {
  for (const value of values)
    if (!counts.has(value))
      counts.set(value, 0);
}

function CountFilterMatches(app, filters) {
  const catalog = app.State.movies.filter((title) => IsTitleAllowed(title, filters)).length;
  const recommendations = app.State.recommendationQueue.filter((title) => IsTitleAllowed(title, filters)).length;
  return { catalog, catalogTotal: app.State.movies.length, recommendations, recommendationTotal: app.State.recommendationQueue.length };
}

function BuildDialogPreview(app, counts) {
  const media = MediaLabel(app, counts.catalogTotal);
  const hidden = Math.max(0, counts.catalogTotal - counts.catalog);
  return `${FormatCount(counts.catalog)} of ${FormatCount(counts.catalogTotal)} ${media} match. ${FormatCount(hidden)} stay outside this filter.`;
}

function BuildRecommendationPreview(app, counts) {
  const media = MediaLabel(app, counts.catalog);
  const catalog = `${FormatCount(counts.catalog)} ${media} in the catalog`;
  if (!counts.recommendationTotal)
    return `${catalog} match this filter. New picks will come only from them.`;
  return `${catalog} match · ${FormatCount(counts.recommendations)} of ${FormatCount(counts.recommendationTotal)} saved picks fit.`;
}

function ReadCatalogYearRange(titles) {
  const years = titles.map((title) => Number(title.year)).filter(Number.isInteger);
  return [years.length ? Math.min(...years) : 1870, years.length ? Math.max(...years) : 2200];
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

function ReadOptionName(names, code) {
  if (!names)
    return code;
  try {
    return names.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function ToDataAttribute(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function Capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function MediaLabel(app, count) {
  if (app.State.mediaType === "tv")
    return count === 1 ? "show" : "shows";
  return count === 1 ? "movie" : "movies";
}
