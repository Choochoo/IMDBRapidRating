const SpaceSeparator = " ";

export function NormalizeRecommendationQueue(value) {
  const items = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const item of items) {
    const recommendation = NormalizeRecommendationItem(item);
    if (!recommendation || normalized.some((existing) => SameRecommendation(existing, recommendation)))
      continue;
    normalized.push(recommendation);
  }
  return normalized;
}

export function NormalizeRecommendationItem(value) {
  const title = CleanText(value?.title);
  if (!title)
    return null;
  const year = ReadYear(value?.year);
  const ttId = ReadRecommendationId(value?.ttId);
  return BuildRecommendationItem(value, title, year, ttId);
}

function ReadRecommendationId(value) {
  const ttId = String(value || "").trim();
  return /^tt\d+$/.test(ttId) ? ttId : "";
}

function BuildRecommendationItem(value, title, year, ttId) {
  return {
    ...value,
    queueKey: RecommendationKey({ title, year, ttId }),
    ttId,
    title,
    year,
    genres: ReadGenres(value?.genres),
    why: NormalizeWhy(value?.why),
    addedAt: ReadTimestamp(value?.addedAt)
  };
}

export function RecommendationKey(value) {
  const title = NormalizeTitle(value?.title);
  const year = ReadYear(value?.year) || "";
  if (title)
    return `${title}|${year}`;
  const ttId = String(value?.ttId || "").trim();
  return /^tt\d+$/.test(ttId) ? ttId : "";
}

export function SameRecommendation(left, right) {
  const leftId = String(left?.ttId || "").trim();
  const rightId = String(right?.ttId || "").trim();
  if (leftId && rightId && leftId === rightId)
    return true;
  const leftTitle = NormalizeTitle(left?.title);
  const rightTitle = NormalizeTitle(right?.title);
  if (!leftTitle || leftTitle !== rightTitle)
    return false;
  const leftYear = ReadYear(left?.year);
  const rightYear = ReadYear(right?.year);
  return !leftYear || !rightYear || leftYear === rightYear;
}

export function NormalizeTitle(value) {
  return CleanText(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, SpaceSeparator).trim();
}

function NormalizeWhy(value) {
  const why = value && typeof value === "object" ? value : {};
  return {
    tasteMatch: CleanText(why.tasteMatch),
    ratingEvidence: Array.isArray(why.ratingEvidence) ? why.ratingEvidence.map(CleanText).filter(Boolean) : []
  };
}

function ReadGenres(value) {
  if (Array.isArray(value))
    return value.map(CleanText).filter(Boolean);
  return CleanText(value).split(",").map(CleanText).filter(Boolean);
}

function ReadYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : null;
}

function ReadTimestamp(value) {
  const timestamp = String(value || "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : new Date().toISOString();
}

function CleanText(value) {
  return String(value || "").replace(/\s+/g, SpaceSeparator).trim();
}
