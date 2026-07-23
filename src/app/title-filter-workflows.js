import {
  CountActiveTitleFilters,
  IsTitleAllowed,
  NormalizeTitleFilters,
  NormalizeTitleOrigin
} from "../../shared/title-filters.js";
import { TvMediaType, TvShowName } from "./app-constants.js";
import { FormatCount } from "./util.js";

const AnyFilterLabel = "Any";
const AriaLabelAttribute = "aria-label";
const EnglishLocale = "en";
const PluralSuffix = "s";
const InvalidYearRangeMessage = "The starting year must be before the ending year.";
const ShowLabel = "show";
const MovieLabel = "movie";
const CommonCountries = Object.freeze(["US", "GB", "CA", "AU", "FR", "DE", "ES", "IT", "JP", "KR", "IN", "MX"]);
const CommonLanguages = Object.freeze([EnglishLocale, "es", "fr", "de", "it", "ja", "ko", "hi", "pt", "zh"]);
const CountryOptionType = "country";
const GenreOptionType = "genre";
const InvalidEndYearMessage = "Enter a valid ending year.";
const InvalidStartYearMessage = "Enter a valid starting year.";
const LanguageOptionType = "language";

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
  UpdateFilterSectionSummaries(app, filters);
  app.Elements.filterPreview.textContent = BuildDialogPreview(app, counts);
  app.Elements.filterError.textContent = ReadYearError(filters, app);
  app.Elements.filtersApply.disabled = Boolean(app.Elements.filterError.textContent);
}

export async function ApplyTitleFilters(app) {
  const filters = ReadTitleFilterForm(app);
  const error = ReadYearError(filters, app);
  if (error)
    return ShowTitleFilterValidation(app, error);
  return await SaveTitleFilters(app, filters, { hideDialog: true, announce: true });
}

export async function ApplyRecommendationYearFilters(app) {
  const result = ReadRecommendationYearDraft(app);
  if (!result.ok) {
    app.ShowRecommendationError(result.error);
    return false;
  }
  if (HaveSameRecommendationYears(app.State.filters, result.filters))
    return true;
  await SaveTitleFilters(app, result.filters, { hideDialog: false, announce: false });
  return true;
}

export function UpdateTitleFilterButton(app) {
  const count = CountActiveTitleFilters(app.State.filters);
  SetFilterButtonState(app.Elements.configureFilters, app.Elements.filterActiveCount, count);
  SetFilterButtonState(app.Elements.recommendationFilterMore, app.Elements.recommendationFilterCount, count);
  SetFilterButtonState(app.Elements.recommendationFilterEdit, app.Elements.recommendationGeneratorFilterCount, count);
  app.Elements.configureFilters.title = count ? `${count} active filter${count === 1 ? "" : PluralSuffix}` : "Filter ratings and recommendations";
  app.Elements.configureFilters.setAttribute(AriaLabelAttribute, app.Elements.configureFilters.title);
  app.Elements.recommendationFilterMore.title = count ? `${count} active filter${count === 1 ? "" : PluralSuffix}. Open advanced filters.` : "Open advanced watchlist filters";
  app.Elements.recommendationFilterMore.setAttribute(AriaLabelAttribute, app.Elements.recommendationFilterMore.title);
  UpdateRecommendationFilterControls(app);
}

function SetFilterButtonState(button, badge, count) {
  badge.textContent = String(count);
  badge.hidden = count === 0;
  button.classList.toggle("filter-active", count > 0);
}

function ShowTitleFilterValidation(app, error) {
  app.Elements.filterError.textContent = error;
  return false;
}

async function SaveTitleFilters(app, filters, options) {
  SetFilterSaving(app, true);
  try {
    await PersistTitleFilters(app, filters);
    CompleteTitleFilterApply(app, options);
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

function CompleteTitleFilterApply(app, options) {
  UpdateTitleFilterButton(app);
  app.RenderRecommendationQueue();
  app.UpdateRecommendationStatus();
  if (options.hideDialog)
    HideTitleFilterDialog(app);
  if (!options.announce)
    return;
  const count = CountFilterMatches(app, app.State.filters).catalog;
  app.ShowToast(`<strong>Filters applied.</strong> ${FormatCount(count)} catalog titles can be recommended.`);
}

function UpdateRecommendationFilterControls(app) {
  const filters = NormalizeTitleFilters(app.State.filters);
  const [firstYear, lastYear] = ReadCatalogYearRange(app.State.movies);
  SetYearInput(app.Elements.recommendationMinYear, firstYear, lastYear, filters.minYear);
  SetYearInput(app.Elements.recommendationMaxYear, firstYear, lastYear, filters.maxYear);
  app.Elements.recommendationPickFilterSummary.textContent = BuildRecommendationFilterSummary(app, filters);
}

function BuildRecommendationFilterSummary(app, filters) {
  const from = filters.minYear || AnyFilterLabel;
  const through = filters.maxYear || AnyFilterLabel;
  const count = CountFilterMatches(app, filters).catalog;
  return `${from}–${through} · ${FormatCount(count)} ${MediaLabel(app, count)} match`;
}

function ReadRecommendationYearDraft(app) {
  const minYear = ReadRecommendationYearValue(app.Elements.recommendationMinYear);
  const maxYear = ReadRecommendationYearValue(app.Elements.recommendationMaxYear);
  if (Number.isNaN(minYear))
    return { ok: false, error: InvalidStartYearMessage };
  if (Number.isNaN(maxYear))
    return { ok: false, error: InvalidEndYearMessage };
  if (minYear && maxYear && minYear > maxYear)
    return { ok: false, error: InvalidYearRangeMessage };
  return { ok: true, filters: NormalizeTitleFilters({ ...app.State.filters, minYear, maxYear }) };
}

function ReadRecommendationYearValue(input) {
  if (!String(input.value || "").trim())
    return null;
  const year = Number(input.value);
  const minimum = Number(input.min) || 1870;
  const maximum = Number(input.max) || 2200;
  return Number.isInteger(year) && year >= minimum && year <= maximum ? year : Number.NaN;
}

function HaveSameRecommendationYears(current, next) {
  const filters = NormalizeTitleFilters(current);
  return filters.minYear === next.minYear && filters.maxYear === next.maxYear;
}

function SetFilterSaving(app, value) {
  app.Elements.filtersApply.disabled = value;
  app.Elements.filtersApply.textContent = value ? "Applying..." : "Apply filters";
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
  const isTv = app.State.mediaType === TvMediaType;
  app.Elements.filtersTitle.textContent = `${isTv ? TvShowName : "Movie"} filters`;
  app.Elements.filtersDescription.textContent = `Choose exactly what can appear in ${isTv ? ShowLabel : MovieLabel} recommendations and the rating queue. Saved watchlist titles outside the filter stay saved.`;
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
  RenderOptionList(app.Elements.filterGenreOptions, counts.genres, filters.includedGenres, GenreOptionType);
  RenderOptionList(app.Elements.filterCountryOptions, counts.countries, filters.includedOriginCountries, CountryOptionType);
  RenderOptionList(app.Elements.filterLanguageOptions, counts.languages, filters.includedOriginalLanguages, LanguageOptionType);
  UpdateOriginNote(app, counts.knownOrigins);
}

function UpdateOriginNote(app, known) {
  const total = app.State.movies.length;
  app.Elements.filterOriginNote.textContent = known
    ? `Verified origin metadata is available for ${FormatCount(known)} of ${FormatCount(total)} titles. A selected language or country never admits an unknown match.`
    : "Language and country filters are strict. Titles without verified origin metadata will not match a selected language or country.";
  app.Elements.filterBollywood.disabled = false;
}

function UpdateFilterSectionSummaries(app, filters) {
  SetFilterSectionSummary(app.Elements.filterGenreSummary, filters.includedGenres.length);
  SetFilterSectionSummary(app.Elements.filterCountrySummary, filters.includedOriginCountries.length);
  SetFilterSectionSummary(app.Elements.filterLanguageSummary, filters.includedOriginalLanguages.length);
}

function SetFilterSectionSummary(element, count) {
  element.textContent = count ? `${count} selected` : AnyFilterLabel;
}

function RenderOptionList(container, counts, selected, type) {
  container.replaceChildren();
  const options = BuildOptions(counts, type);
  for (const option of options)
    container.append(BuildOption(option, selected.includes(option.code), type));
}

function BuildOptions(counts, type) {
  const names = type === GenreOptionType ? null : DisplayNames(type);
  const options = [...counts.entries()].map(([code, count]) => ({ code, count, name: ReadOptionName(names, code) }));
  return options.sort((left, right) => left.name.localeCompare(right.name));
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

function BuildCheckbox(code, checked, dataKey) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.checked = checked;
  input.dataset[dataKey] = code;
  return input;
}

function ReadTitleFilterForm(app) {
  const filters = {
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
  };
  return NormalizeTitleFilters(filters);
}

function ReadCheckedCodes(container, key) {
  const attribute = ToDataAttribute(key);
  return [...container.querySelectorAll(`input[data-${attribute}]:checked`)].map((input) => input.dataset[key]);
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
  return { catalog, catalogTotal: app.State.movies.length };
}

function BuildDialogPreview(app, counts) {
  const media = MediaLabel(app, counts.catalogTotal);
  const hidden = Math.max(0, counts.catalogTotal - counts.catalog);
  return `${FormatCount(counts.catalog)} of ${FormatCount(counts.catalogTotal)} ${media} match. ${FormatCount(hidden)} stay outside this filter.`;
}

function ReadCatalogYearRange(titles) {
  const years = titles.map((title) => Number(title.year)).filter(Number.isInteger);
  return [years.length ? Math.min(...years) : 1870, years.length ? Math.max(...years) : 2200];
}

function ReadYearError(filters, app) {
  const min = Number(app.Elements.filterMinYear.value);
  const max = Number(app.Elements.filterMaxYear.value);
  if (app.Elements.filterMinYear.value && !filters.minYear)
    return InvalidStartYearMessage;
  if (app.Elements.filterMaxYear.value && !filters.maxYear)
    return InvalidEndYearMessage;
  if (min && max && min > max)
    return InvalidYearRangeMessage;
  return "";
}

function DisplayNames(type) {
  try {
    return new Intl.DisplayNames([globalThis.navigator?.language || EnglishLocale], { type: type === CountryOptionType ? "region" : LanguageOptionType });
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
  if (app.State.mediaType === TvMediaType)
    return count === 1 ? ShowLabel : "shows";
  return count === 1 ? MovieLabel : "movies";
}
