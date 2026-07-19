export const DefaultTitleFilters = Object.freeze({
  minYear: null,
  maxYear: null,
  excludedOriginCountries: Object.freeze([]),
  excludedOriginalLanguages: Object.freeze([]),
  excludeBollywood: false,
  includeUnknownOrigin: true,
  updatedAt: ""
});

export function NormalizeTitleFilters(value) {
  const source = ReadObject(value);
  const minYear = NormalizeYear(source.minYear);
  const maxYear = NormalizeYear(source.maxYear);
  return {
    minYear: minYear && maxYear && minYear > maxYear ? maxYear : minYear,
    maxYear: minYear && maxYear && minYear > maxYear ? minYear : maxYear,
    excludedOriginCountries: NormalizeCodes(source.excludedOriginCountries, NormalizeCountryCode),
    excludedOriginalLanguages: NormalizeCodes(source.excludedOriginalLanguages, NormalizeLanguageCode),
    excludeBollywood: Boolean(source.excludeBollywood),
    includeUnknownOrigin: source.includeUnknownOrigin !== false,
    updatedAt: NormalizeTimestamp(source.updatedAt)
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
  const year = NormalizeYear(title?.year || title?.startYear);
  if (filters.minYear && (!year || year < filters.minYear))
    return false;
  if (filters.maxYear && (!year || year > filters.maxYear))
    return false;
  const origin = NormalizeTitleOrigin(title);
  const countrySet = new Set(origin.originCountries);
  if (!filters.includeUnknownOrigin && !origin.originCountries.length && !origin.originalLanguage)
    return false;
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
    || filters.excludedOriginCountries.length
    || filters.excludedOriginalLanguages.length
    || filters.excludeBollywood
    || !filters.includeUnknownOrigin);
}

export function CountActiveTitleFilters(value) {
  const filters = NormalizeTitleFilters(value);
  let count = filters.excludedOriginCountries.length + filters.excludedOriginalLanguages.length;
  if (filters.minYear || filters.maxYear)
    count++;
  if (filters.excludeBollywood)
    count++;
  if (!filters.includeUnknownOrigin)
    count++;
  return count;
}

export function TitleFilterSignature(value) {
  const filters = NormalizeTitleFilters(value);
  return JSON.stringify({
    minYear: filters.minYear,
    maxYear: filters.maxYear,
    excludedOriginCountries: filters.excludedOriginCountries,
    excludedOriginalLanguages: filters.excludedOriginalLanguages,
    excludeBollywood: filters.excludeBollywood,
    includeUnknownOrigin: filters.includeUnknownOrigin
  });
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
