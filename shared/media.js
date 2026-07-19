export const MediaTypes = Object.freeze(["movie", "tv"]);

const MediaStateKeys = Object.freeze([
  "ratings",
  "recommendationExclusions",
  "letterboxd",
  "history",
  "signature",
  "queueIds"
]);

export function NormalizeMediaType(value, fallback = "movie") {
  const mediaType = String(value || "").trim().toLowerCase();
  return MediaTypes.includes(mediaType) ? mediaType : fallback;
}

export function NormalizeAccountPayload(value) {
  const source = ReadObject(value);
  if (ReadObject(source.media).movie || ReadObject(source.media).tv)
    return BuildNormalizedPayload(source);
  const legacyMovie = PickMediaState(source);
  const root = OmitMediaState(source);
  return {
    ...root,
    media: {
      movie: legacyMovie,
      tv: {}
    }
  };
}

export function ReadMediaPayload(value, mediaType = "movie") {
  const normalized = NormalizeAccountPayload(value);
  return ReadObject(normalized.media[NormalizeMediaType(mediaType)]);
}

export function WriteMediaPayload(value, mediaType, mediaPayload) {
  const normalized = NormalizeAccountPayload(value);
  const key = NormalizeMediaType(mediaType);
  return {
    ...normalized,
    media: {
      ...normalized.media,
      [key]: ReadObject(mediaPayload)
    }
  };
}

function BuildNormalizedPayload(source) {
  const root = OmitMediaState(source);
  const media = ReadObject(source.media);
  return {
    ...root,
    media: {
      movie: ReadObject(media.movie),
      tv: ReadObject(media.tv)
    }
  };
}

function PickMediaState(source) {
  return Object.fromEntries(MediaStateKeys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function OmitMediaState(source) {
  const root = { ...source };
  for (const key of MediaStateKeys)
    delete root[key];
  return root;
}

function ReadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
