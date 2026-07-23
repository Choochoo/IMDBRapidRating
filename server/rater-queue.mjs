import { createHash, randomBytes } from "node:crypto";

const HexEncoding = "hex";

export function CreateQueueSeed() {
  return randomBytes(32).toString(HexEncoding);
}

export function ReconcileQueueIds(savedValue, poolValue, unavailableValue, seed) {
  const poolIds = UniqueMovieIds(poolValue);
  const poolSet = new Set(poolIds);
  const unavailable = new Set(UniqueMovieIds(unavailableValue));
  const saved = UniqueMovieIds(savedValue).filter((ttId) => poolSet.has(ttId) && !unavailable.has(ttId));
  const savedSet = new Set(saved);
  const additions = poolIds.filter((ttId) => !savedSet.has(ttId) && !unavailable.has(ttId));
  additions.sort((left, right) => CompareSeededIds(seed, left, right));
  return saved.concat(additions);
}

export function QueueSnapshot(row) {
  return {
    revision: Number(row?.revision) || 0,
    poolVersion: String(row?.pool_version || row?.poolVersion || ""),
    queueIds: UniqueMovieIds(row?.queue_ids || row?.queueIds)
  };
}

export function SameQueueIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
    return false;
  return left.every((value, index) => value === right[index]);
}

function CompareSeededIds(seed, left, right) {
  const leftHash = SeededHash(seed, left);
  const rightHash = SeededHash(seed, right);
  return leftHash.localeCompare(rightHash) || left.localeCompare(right);
}

function SeededHash(seed, ttId) {
  return createHash("sha256").update(`${seed}:${ttId}`, "utf8").digest(HexEncoding);
}

function UniqueMovieIds(value) {
  if (!Array.isArray(value))
    return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const ttId = String(item || "").trim();
    if (!/^tt\d+$/.test(ttId) || seen.has(ttId))
      continue;
    seen.add(ttId);
    ids.push(ttId);
  }
  return ids;
}
