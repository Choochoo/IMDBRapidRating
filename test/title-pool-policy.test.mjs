import assert from "node:assert/strict";
import test from "node:test";
import { IsVoteCountEligible, MinimumVoteCount, RequiredVotesForYear } from "../scripts/title-pool-policy.mjs";

const PolicyData = {
  minVotes: 2500,
  recentMinVotes: 100,
  recentYearCutoff: 2025
};
const Policy = Object.freeze(PolicyData);

test("recent and future-dated titles use the lower vote threshold", VerifyRecentThresholds);
test("vote eligibility changes at the recent-year boundary", VerifyVoteEligibility);

function VerifyRecentThresholds() {
  assert.equal(RequiredVotesForYear(2024, Policy), 2500);
  assert.equal(RequiredVotesForYear(2025, Policy), 100);
  assert.equal(RequiredVotesForYear(2026, Policy), 100);
  assert.equal(RequiredVotesForYear(2027, Policy), 100);
}

function VerifyVoteEligibility() {
  assert.equal(IsVoteCountEligible(2024, 2499, Policy), false);
  assert.equal(IsVoteCountEligible(2024, 2500, Policy), true);
  assert.equal(IsVoteCountEligible(2025, 99, Policy), false);
  assert.equal(IsVoteCountEligible(2025, 100, Policy), true);
  assert.equal(MinimumVoteCount(Policy), 100);
}
