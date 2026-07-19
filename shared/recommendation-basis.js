export const DefaultRecommendationBasis = Object.freeze({
  source: "current",
  updatedAt: ""
});

export function NormalizeRecommendationBasis(value) {
  const source = typeof value === "string" ? value : value?.source;
  return {
    source: ["current", "other", "both"].includes(source) ? source : DefaultRecommendationBasis.source,
    updatedAt: NormalizeTimestamp(typeof value === "object" ? value?.updatedAt : "")
  };
}

function NormalizeTimestamp(value) {
  const timestamp = String(value || "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}
