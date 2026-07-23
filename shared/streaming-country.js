export const DefaultStreamingCountry = "US";

export function NormalizeStreamingCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

export function ReadStreamingCountry(value) {
  return NormalizeStreamingCountry(value) || DefaultStreamingCountry;
}
