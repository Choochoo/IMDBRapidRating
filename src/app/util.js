const HtmlEntities = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
});

export function CleanText(value) {
  return String(value ?? "").trim();
}

export function EscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HtmlEntities[char]);
}

export function FormatCount(value) {
  return Number(value || 0).toLocaleString();
}

export function NormalizeGenres(value) {
  if (Array.isArray(value))
    return value.map(CleanText).filter(Boolean);
  if (!value || value === "\\N")
    return [];
  return String(value).split(",").map(CleanText).filter(Boolean);
}

export function Shuffle(items) {
  const output = items.slice();
  for (let index = output.length - 1; index > 0; index--)
    SwapItems(output, index, Math.floor(Math.random() * (index + 1)));
  return output;
}

export function ToNumber(value) {
  if (value === null || value === undefined || value === "" || value === "\\N")
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function SwapItems(items, leftIndex, rightIndex) {
  const item = items[leftIndex];
  items[leftIndex] = items[rightIndex];
  items[rightIndex] = item;
}
