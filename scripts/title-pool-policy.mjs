export function RequiredVotesForYear(year, policy) {
  const releaseYear = Number(year);
  const cutoffYear = Number(policy?.recentYearCutoff);
  const recent = Number.isInteger(releaseYear) && Number.isInteger(cutoffYear) && releaseYear >= cutoffYear;
  return recent ? ReadVoteCount(policy?.recentMinVotes) : ReadVoteCount(policy?.minVotes);
}

export function IsVoteCountEligible(year, numVotes, policy) {
  return Number(numVotes) >= RequiredVotesForYear(year, policy);
}

export function MinimumVoteCount(policy) {
  return Math.min(ReadVoteCount(policy?.minVotes), ReadVoteCount(policy?.recentMinVotes));
}

function ReadVoteCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}
