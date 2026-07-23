import { NormalizeAccountPayload, ReadMediaPayload, WriteMediaPayload } from "../../shared/media.js";
import { NormalizeTitleFilters } from "../../shared/title-filters.js";
import { NormalizeRecommendationBasis } from "../../shared/recommendation-basis.js";

export function MergeAccountPayload(remoteValue, localValue) {
  const remote = NormalizeAccountPayload(remoteValue);
  const local = NormalizeAccountPayload(localValue);
  let merged = {
    ...remote,
    ...local,
    media: remote.media
  };
  for (const mediaType of ["movie", "tv"])
    merged = WriteMediaPayload(merged, mediaType, MergeMediaPayload(ReadMediaPayload(remote, mediaType), ReadMediaPayload(local, mediaType)));
  return merged;
}

function MergeMediaPayload(remote, local) {
  const merged = {
    ...remote,
    ...local,
    ratings: MergeRecordMaps(remote.ratings, local.ratings),
    recommendationExclusions: MergeExclusions(remote.recommendationExclusions, local.recommendationExclusions),
    history: MergeHistory(remote.history, local.history),
    filters: NewestFilters(remote.filters, local.filters),
    recommendationBasis: NewestRecommendationBasis(remote.recommendationBasis, local.recommendationBasis)
  };
  if (remote.letterboxd || local.letterboxd)
    merged.letterboxd = NewestLetterboxdSnapshot(remote.letterboxd, local.letterboxd);
  delete merged.queueIds;
  delete merged.signature;
  return merged;
}

function NewestRecommendationBasis(remoteValue, localValue) {
  return NewestTimestampedValue(
    NormalizeRecommendationBasis(remoteValue),
    NormalizeRecommendationBasis(localValue)
  );
}

function NewestFilters(remoteValue, localValue) {
  return NewestTimestampedValue(NormalizeTitleFilters(remoteValue), NormalizeTitleFilters(localValue));
}

function NewestTimestampedValue(remote, local) {
  if (!remote.updatedAt)
    return local;
  if (!local.updatedAt)
    return remote;
  return ReadTime(remote.updatedAt) > ReadTime(local.updatedAt) ? remote : local;
}

export function MergeRecordMaps(remoteValue, localValue) {
  const remote = ReadObject(remoteValue);
  const local = ReadObject(localValue);
  const merged = { ...remote };
  for (const [ttId, localRecord] of Object.entries(local)) {
    const remoteRecord = remote[ttId];
    merged[ttId] = NewestRecord(remoteRecord, localRecord);
  }
  return merged;
}

function NewestRecord(remote, local) {
  if (!remote)
    return local;
  if (!local)
    return remote;
  const remoteTime = RecordTime(remote);
  const localTime = RecordTime(local);
  return remoteTime >= localTime ? remote : local;
}

function RecordTime(record) {
  return Math.max(ReadTime(record?.at), ReadTime(record?.submittedAt), ReadTime(record?.updatedAt));
}

function MergeExclusions(remoteValue, localValue) {
  const merged = new Map();
  for (const item of [...ReadArray(remoteValue), ...ReadArray(localValue)]) {
    const key = ExclusionKey(item);
    if (!key)
      continue;
    const existing = merged.get(key);
    if (!existing || ReadTime(item?.at) >= ReadTime(existing?.at))
      merged.set(key, item);
  }
  return [...merged.values()];
}

function ExclusionKey(value) {
  const ttId = String(value?.ttId || "").trim();
  if (/^tt\d+$/.test(ttId))
    return ttId;
  const title = String(value?.title || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  return title ? `${title}|${Number(value?.year) || ""}` : "";
}

function NewestLetterboxdSnapshot(remoteValue, localValue) {
  const remote = ReadObject(remoteValue);
  const local = ReadObject(localValue);
  if (!Object.keys(remote).length)
    return local;
  if (!Object.keys(local).length)
    return remote;
  return ReadTime(remote.importedAt) > ReadTime(local.importedAt) ? remote : local;
}

function MergeHistory(remoteValue, localValue) {
  const merged = new Map();
  for (const item of [...ReadArray(remoteValue), ...ReadArray(localValue)]) {
    if (!item?.ttId)
      continue;
    merged.set(`${item.ttId}|${JSON.stringify(item.previous ?? null)}`, item);
  }
  return [...merged.values()].slice(-200);
}

function ReadTime(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ReadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ReadArray(value) {
  return Array.isArray(value) ? value : [];
}
