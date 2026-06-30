import { FormatCount } from "./util.js";
import { IsRetryableImdbSubmit } from "./rating-records.js";

export function CountRatings(ratings) {
  const counts = BuildEmptyCounts();
  for (const item of Object.values(ratings))
    CountRatingItem(counts, item);
  return counts;
}

export function BuildCompleteSummary(counts) {
  const rated = `${FormatCount(counts.rated)} rated`;
  const skipped = `${FormatCount(counts.skipped)} not seen`;
  const imported = `${FormatCount(counts.imported)} from CSV`;
  return `${rated}, ${skipped}, ${imported}.`;
}

function BuildEmptyCounts() {
  return {
    rated: 0,
    skipped: 0,
    imported: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    retryableImdb: 0
  };
}

function CountRatingItem(counts, item) {
  if (item.status === "rated")
    counts.rated++;
  if (item.status === "notSeen")
    counts.skipped++;
  if (item.status === "imported")
    counts.imported++;
  CountSubmitStatus(counts, item);
}

function CountSubmitStatus(counts, item) {
  if (item.submitStatus === "submitted")
    counts.sent++;
  if (item.submitStatus === "failed")
    counts.failed++;
  if (item.submitStatus === "pending")
    counts.pending++;
  if (IsRetryableImdbSubmit(item))
    counts.retryableImdb++;
}
