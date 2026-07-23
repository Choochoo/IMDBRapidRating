import { EscapeHtml } from "./util.js";

const PeopleEmptyClass = "people-empty";
const PendingRelationshipStatus = "pending";
const PrimaryButtonClass = "btn btn-sm btn-primary";
const DefaultUserInitial = "R";
const RapidRaterUserLabel = "Rapid Rater user";
const RelationshipLabelClass = "relationship-label";
const SecondaryButtonClass = "btn btn-sm btn-outline-secondary";
const SmallAvatarClass = "avatar-small";

export function RenderAvatar(profile, className = "") {
  const name = EscapeHtml(profile?.displayName || profile?.handle || RapidRaterUserLabel);
  const initial = EscapeHtml(ReadInitial(profile));
  const image = profile?.avatarUrl ? ` style="background-image:url('${EscapeCssUrl(profile.avatarUrl)}')"` : "";
  return `<span class="avatar ${className}"${image} role="img" aria-label="${name}">${initial}</span>`;
}

export function ApplyAvatar(element, profile) {
  if (!element)
    return;
  element.textContent = ReadInitial(profile);
  element.setAttribute("aria-label", profile?.displayName || profile?.handle || RapidRaterUserLabel);
  element.style.backgroundImage = profile?.avatarUrl ? `url("${EscapeCssUrl(profile.avatarUrl)}")` : "";
}

export function RenderPeople(items, mode) {
  if (!items.length)
    return mode === "friends" ? `<div class="${PeopleEmptyClass}">No friends yet. Search above to find someone you know.</div>` : "";
  return items.map((item) => RenderPerson(item, mode)).join("");
}

export function RenderSearchResults(results) {
  if (!results.length)
    return `<div class="${PeopleEmptyClass}">No matching users were found.</div>`;
  return results.map(RenderSearchResult).join("");
}

export function RenderFriendCheckboxes(friends, name, selectedIds = []) {
  if (!friends.length)
    return `<p class="${PeopleEmptyClass}">Add a friend before using this option.</p>`;
  const selected = new Set(selectedIds);
  return friends.map((item) => RenderFriendCheckbox(item.profile, name, selected.has(item.profile.userId))).join("");
}

export function RenderSocialBadges(context, showRatings = true) {
  const signals = BuildSocialSignals(context, showRatings);
  if (!signals.length)
    return "";
  const visible = signals.slice(0, 3).map(RenderSocialSignal).join("");
  const more = signals.length > 3 ? `<span class="social-avatar-more">+${signals.length - 3}</span>` : "";
  const label = EscapeHtml(signals.map((item) => item.label).join("; "));
  return `<div class="social-poster-badges" data-social-badges title="${label}" aria-label="${label}">${visible}${more}</div>`;
}

function RenderPerson(item, mode) {
  const profile = item.profile;
  const identity = RenderIdentity(profile);
  const actions = RenderPersonActions(item, mode);
  return `<article class="person-card card">${RenderAvatar(profile)}${identity}<div class="person-actions">${actions}</div></article>`;
}

function RenderSearchResult(item) {
  const profile = item.profile;
  const identity = RenderIdentity(profile);
  const action = RenderSearchAction(item);
  return `<article class="person-card person-search-result">${RenderAvatar(profile)}${identity}<div class="person-actions">${action}</div></article>`;
}

function RenderIdentity(profile) {
  const displayName = EscapeHtml(profile?.displayName || "Rapid Rater User");
  const handle = EscapeHtml(profile?.handle || "");
  return `<span class="person-identity"><strong>${displayName}</strong><small>@${handle}</small></span>`;
}

function RenderPersonActions(item, mode) {
  if (mode === "incoming")
    return `<button type="button" class="${PrimaryButtonClass}" data-friend-accept="${EscapeHtml(item.relationshipId)}">Accept</button><button type="button" class="${SecondaryButtonClass}" data-friend-delete="${EscapeHtml(item.relationshipId)}">Decline</button>`;
  if (mode === "outgoing")
    return `<button type="button" class="${SecondaryButtonClass}" data-friend-delete="${EscapeHtml(item.relationshipId)}">Cancel</button>`;
  return `<button type="button" class="${SecondaryButtonClass}" data-friend-delete="${EscapeHtml(item.relationshipId)}">Remove</button><button type="button" class="btn btn-sm btn-link text-danger" data-friend-block="${EscapeHtml(item.profile.userId)}">Block</button>`;
}

function RenderSearchAction(item) {
  if (item.relationshipStatus === "accepted")
    return `<span class="${RelationshipLabelClass}">Friends</span>`;
  if (item.relationshipStatus === PendingRelationshipStatus && item.outgoing)
    return `<span class="${RelationshipLabelClass}">Request sent</span>`;
  if (item.relationshipStatus === PendingRelationshipStatus)
    return `<button type="button" class="${PrimaryButtonClass}" data-friend-accept="${EscapeHtml(item.relationshipId)}">Accept</button>`;
  return `<button type="button" class="${PrimaryButtonClass}" data-friend-request="${EscapeHtml(item.profile.userId)}">Add friend</button>`;
}

function RenderFriendCheckbox(profile, name, selected) {
  const id = `${name}-${profile.userId}`;
  const checked = selected ? " checked" : "";
  return `<label class="friend-checkbox" for="${EscapeHtml(id)}"><input id="${EscapeHtml(id)}" type="checkbox" name="${EscapeHtml(name)}" value="${EscapeHtml(profile.userId)}"${checked}>${RenderAvatar(profile, SmallAvatarClass)}<span>${EscapeHtml(profile.displayName)}</span></label>`;
}

function BuildSocialSignals(context, showRatings) {
  const signals = new Map();
  for (const profile of context?.sharedBy || [])
    AddSocialSignal(signals, profile, "Shared by");
  for (const profile of context?.sharedWith || [])
    AddSocialSignal(signals, profile, "Shared with");
  if (showRatings)
    AddRatingSignals(signals, context?.ratings || []);
  return [...signals.values()];
}

function AddRatingSignals(signals, ratings) {
  for (const item of ratings) {
    const signal = AddSocialSignal(signals, item.profile, "Rated");
    signal.rating = item.rating;
    signal.label = BuildRatingLabel(signal.label, item);
  }
}

function BuildRatingLabel(existing, item) {
  const rating = `${item.profile.displayName} rated ${item.rating}/10`;
  return existing.startsWith("Shared ") ? `${existing}; ${rating}` : rating;
}

function AddSocialSignal(signals, profile, verb) {
  const existing = signals.get(profile.userId);
  if (existing)
    return existing;
  const signal = { profile, rating: 0, label: `${verb} ${profile.displayName}` };
  signals.set(profile.userId, signal);
  return signal;
}

function RenderSocialSignal(signal) {
  const rating = signal.rating ? `<strong>${signal.rating}</strong>` : "";
  return `<span class="social-avatar-signal">${RenderAvatar(signal.profile, SmallAvatarClass)}${rating}</span>`;
}

function ReadInitial(profile) {
  const value = String(profile?.displayName || profile?.handle || DefaultUserInitial).trim();
  return value.charAt(0).toUpperCase() || DefaultUserInitial;
}

function EscapeCssUrl(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("'", "\\'");
}
