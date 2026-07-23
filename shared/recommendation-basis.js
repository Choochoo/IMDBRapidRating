const CurrentRecommendationSource = "current";
const DefaultRecommendationBasisValue = {
  source: CurrentRecommendationSource,
  updatedAt: ""
};
export const DefaultRecommendationBasis = Object.freeze(DefaultRecommendationBasisValue);

export function NormalizeRecommendationBasis(value) {
  const source = typeof value === "string" ? value : value?.source;
  return {
    source: [CurrentRecommendationSource, "other", "both"].includes(source) ? source : DefaultRecommendationBasis.source,
    updatedAt: NormalizeTimestamp(typeof value === "object" ? value?.updatedAt : "")
  };
}

function NormalizeTimestamp(value) {
  const timestamp = String(value || "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}
