export const DefaultTitleFilters = Object.freeze({
  minYear: null,
  maxYear: null,
  includedGenres: Object.freeze([]),
  documentaryMode: "any",
  minImdbRating: null,
  maxRuntimeMinutes: null,
  includedOriginCountries: Object.freeze([]),
  includedOriginalLanguages: Object.freeze([]),
  excludedOriginCountries: Object.freeze([]),
  excludedOriginalLanguages: Object.freeze([]),
  excludeBollywood: false,
  includeUnknownOrigin: true,
  updatedAt: ""
});

export function NormalizeTitleFilters(value) {
  const source = ReadObject(value);
  return {
    ...NormalizeYearFilters(source),
    ...NormalizeCatalogFilters(source),
    ...NormalizeOriginFilters(source),
    updatedAt: NormalizeTimestamp(source.updatedAt)
  };
}

function NormalizeYearFilters(source) {
  const minYear = NormalizeYear(source.minYear);
  const maxYear = NormalizeYear(source.maxYear);
  return {
    minYear: minYear && maxYear && minYear > maxYear ? maxYear : minYear,
    maxYear: minYear && maxYear && minYear > maxYear ? minYear : maxYear
  };
}

function NormalizeCatalogFilters(source) {
  return {
    includedGenres: NormalizeGenres(source.includedGenres),
    documentaryMode: NormalizeDocumentaryMode(source.documentaryMode),
    minImdbRating: NormalizeRating(source.minImdbRating),
    maxRuntimeMinutes: NormalizeRuntime(source.maxRuntimeMinutes)
  };
}

function NormalizeOriginFilters(source) {
  return {
    includedOriginCountries: NormalizeCodes(source.includedOriginCountries, NormalizeCountryCode),
    includedOriginalLanguages: NormalizeCodes(source.includedOriginalLanguages, NormalizeLanguageCode),
    excludedOriginCountries: NormalizeCodes(source.excludedOriginCountries, NormalizeCountryCode),
    excludedOriginalLanguages: NormalizeCodes(source.excludedOriginalLanguages, NormalizeLanguageCode),
    excludeBollywood: Boolean(source.excludeBollywood),
    includeUnknownOrigin: source.includeUnknownOrigin !== false
  };
}

export function NormalizeTitleOrigin(value) {
  const source = ReadObject(value);
  return {
    originCountries: NormalizeCodes(source.originCountries || source.productionCountries, NormalizeCountryCode),
    originalLanguage: NormalizeLanguageCode(source.originalLanguage)
  };
}

export function NormalizeTmdbOrigin(mediaType, findResult, details) {
  const productionCountries = Array.isArray(details?.production_countries)
    ? details.production_countries.map((country) => country?.iso_3166_1)
    : [];
  const tvCountries = mediaType === "tv" && Array.isArray(details?.origin_country) ? details.origin_country : [];
  return {
    originCountries: [...new Set([...tvCountries, ...productionCountries]
      .map(NormalizeCountryCode).filter(Boolean))].sort(),
    originalLanguage: NormalizeLanguageCode(details?.original_language || findResult?.original_language)
  };
}

export function IsTitleAllowed(title, filtersValue) {
  const filters = NormalizeTitleFilters(filtersValue);
  if (!IsYearAllowed(title, filters))
    return false;
  if (!IsCatalogAllowed(title, filters))
    return false;
  return IsOriginAllowed(title, filters);
}

function IsYearAllowed(title, filters) {
  const year = NormalizeYear(title?.year || title?.startYear);
  if (filters.minYear && (!year || year < filters.minYear))
    return false;
  if (filters.maxYear && (!year || year > filters.maxYear))
    return false;
  return true;
}

function IsCatalogAllowed(title, filters) {
  if (!IsGenreAllowed(title, filters))
    return false;
  if (!IsRatingAllowed(title, filters))
    return false;
  return IsRuntimeAllowed(title, filters);
}

function IsGenreAllowed(title, filters) {
  const genres = NormalizeGenres(title?.genres).map((genre) => genre.toLowerCase());
  const included = filters.includedGenres.map((genre) => genre.toLowerCase());
  const isDocumentary = genres.includes("documentary");
  if (included.length && !included.some((genre) => genres.includes(genre)))
    return false;
  if (filters.documentaryMode === "only" && !isDocumentary)
    return false;
  return filters.documentaryMode !== "exclude" || !isDocumentary;
}

function IsRatingAllowed(title, filters) {
  if (!filters.minImdbRating)
    return true;
  const rating = NormalizeRating(title?.imdbRating);
  return Boolean(rating && rating >= filters.minImdbRating);
}

function IsRuntimeAllowed(title, filters) {
  if (!filters.maxRuntimeMinutes)
    return true;
  const runtime = NormalizeRuntime(title?.runtimeMinutes);
  return Boolean(runtime && runtime <= filters.maxRuntimeMinutes);
}

function IsOriginAllowed(title, filters) {
  const origin = NormalizeTitleOrigin(title);
  if (!IsIncludedOriginAllowed(origin, filters))
    return false;
  return IsExcludedOriginAllowed(origin, filters);
}

function IsIncludedOriginAllowed(origin, filters) {
  const countrySet = new Set(origin.originCountries);
  if (filters.includedOriginCountries.length && !filters.includedOriginCountries.some((country) => countrySet.has(country)))
    return false;
  if (filters.includedOriginalLanguages.length && !filters.includedOriginalLanguages.includes(origin.originalLanguage))
    return false;
  if (!filters.includeUnknownOrigin && !origin.originCountries.length && !origin.originalLanguage)
    return false;
  return true;
}

function IsExcludedOriginAllowed(origin, filters) {
  const countrySet = new Set(origin.originCountries);
  if (filters.excludedOriginCountries.some((country) => countrySet.has(country)))
    return false;
  if (origin.originalLanguage && filters.excludedOriginalLanguages.includes(origin.originalLanguage))
    return false;
  if (filters.excludeBollywood && countrySet.has("IN") && origin.originalLanguage === "hi")
    return false;
  return true;
}

export function HasActiveTitleFilters(value) {
  const filters = NormalizeTitleFilters(value);
  return Boolean(filters.minYear
    || filters.maxYear
    || filters.includedGenres.length
    || filters.documentaryMode !== "any"
    || filters.minImdbRating
    || filters.maxRuntimeMinutes
    || filters.includedOriginCountries.length
    || filters.includedOriginalLanguages.length
    || filters.excludedOriginCountries.length
    || filters.excludedOriginalLanguages.length
    || filters.excludeBollywood
    || !filters.includeUnknownOrigin);
}

export function CountActiveTitleFilters(value) {
  const filters = NormalizeTitleFilters(value);
  return CountCatalogFilters(filters) + CountOriginFilters(filters);
}

function CountCatalogFilters(filters) {
  let count = filters.includedGenres.length;
  count += filters.minYear || filters.maxYear ? 1 : 0;
  count += filters.documentaryMode !== "any" ? 1 : 0;
  count += filters.minImdbRating ? 1 : 0;
  count += filters.maxRuntimeMinutes ? 1 : 0;
  return count;
}

function CountOriginFilters(filters) {
  let count = filters.includedOriginCountries.length + filters.includedOriginalLanguages.length;
  count += filters.excludedOriginCountries.length + filters.excludedOriginalLanguages.length;
  count += filters.excludeBollywood ? 1 : 0;
  count += !filters.includeUnknownOrigin ? 1 : 0;
  return count;
}

export function TitleFilterSignature(value) {
  return JSON.stringify(ReadTitleFilterSignature(value));
}

function ReadTitleFilterSignature(value) {
  const { updatedAt, ...signature } = NormalizeTitleFilters(value);
  return signature;
}

export function NormalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

export function NormalizeLanguageCode(value) {
  const code = String(value || "").trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : "";
}

function NormalizeCodes(value, normalize) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map(normalize).filter(Boolean))].sort();
}

function NormalizeGenres(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map((genre) => String(genre || "").trim()).filter(Boolean))].sort();
}

function NormalizeDocumentaryMode(value) {
  return ["any", "exclude", "only"].includes(value) ? value : "any";
}

function NormalizeRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 1 && rating <= 10 ? Math.round(rating * 10) / 10 : null;
}

function NormalizeRuntime(value) {
  const runtime = Number(value);
  return Number.isInteger(runtime) && runtime >= 1 && runtime <= 1440 ? runtime : null;
}

function NormalizeYear(value) {
  if (value === null || value === undefined || value === "")
    return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : null;
}

function NormalizeTimestamp(value) {
  const timestamp = String(value || "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}

function ReadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
