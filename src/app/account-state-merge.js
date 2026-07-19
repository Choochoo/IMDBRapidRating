export function MergeAccountPayload(remoteValue, localValue) {
  const remote = ReadObject(remoteValue);
  const local = ReadObject(localValue);
  const merged = {
    ...remote,
    ...local,
    ratings: MergeRecordMaps(remote.ratings, local.ratings),
    recommendationExclusions: MergeExclusions(remote.recommendationExclusions, local.recommendationExclusions),
    letterboxd: NewestLetterboxdSnapshot(remote.letterboxd, local.letterboxd),
    history: MergeHistory(remote.history, local.history)
  };
  delete merged.queueIds;
  delete merged.signature;
  return merged;
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
  return remoteTime > localTime ? remote : local;
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
