import { RenderSocialBadges } from "../social-rendering.js";
import { ChangeEvent, PostMethod } from "../app-constants.js";

const AllSocialFilterMode = "all";
const MineSocialTasteAudience = "mine";
const RatedSocialFilterMode = "rated";
const SharedSocialFilterMode = "shared";
const ForceSocialContextRefresh = true;
const SocialFilterModes = new Set([AllSocialFilterMode, SharedSocialFilterMode, RatedSocialFilterMode, "liked"]);
const SocialTasteAudiences = new Set([MineSocialTasteAudience, "friends", "both"]);

export class SocialContextFeature {
  BindSocialContextEvents() {
    this.Elements.recommendationAudience.addEventListener(ChangeEvent, () => this.UpdateRecommendationAudienceControl());
    this.Elements.socialFilterMode.addEventListener(ChangeEvent, () => this.HandleSocialFilterChange());
    this.Elements.socialFilterFriends.addEventListener(ChangeEvent, () => this.HandleSocialFilterChange());
  }

  UpdateRecommendationAudienceControl() {
    const audience = this.Elements.recommendationAudience.value;
    this.Elements.recommendationFriendOptions.hidden = audience === MineSocialTasteAudience;
  }

  ReadRecommendationSocialTaste() {
    const audienceValue = this.Elements?.recommendationAudience?.value || MineSocialTasteAudience;
    const audience = SocialTasteAudiences.has(audienceValue) ? audienceValue : MineSocialTasteAudience;
    const friendIds = ReadCheckedValues(this.Elements?.recommendationFriendOptions, "recommendation-friend");
    if (audience !== MineSocialTasteAudience && !friendIds.length)
      throw new Error("Select at least one friend for the recommendation taste source.");
    return { audience, friendIds };
  }

  HandleSocialFilterChange() {
    const mode = this.Elements.socialFilterMode.value;
    this.Social.filterMode = SocialFilterModes.has(mode) ? mode : AllSocialFilterMode;
    this.Social.filterFriendIds = ReadCheckedValues(this.Elements.socialFilterFriends, "social-filter-friend");
    this.RenderRecommendationQueue();
  }

  IsSocialRecommendationVisible(item) {
    if (!this.SocialFilterIsActive())
      return true;
    const context = this.ReadSocialTitleContext(item.ttId);
    const selected = new Set(this.Social.filterFriendIds);
    if (this.Social.filterMode === SharedSocialFilterMode)
      return HasSelectedProfile([...context.sharedBy, ...context.sharedWith], selected);
    if (this.Social.filterMode === RatedSocialFilterMode)
      return HasSelectedRating(context.ratings, selected, 1);
    return HasSelectedRating(context.ratings, selected, 7);
  }

  SocialFilterIsActive() {
    return this.Social.filterMode !== AllSocialFilterMode;
  }

  ReadSocialTitleContext(ttId) {
    return this.Social.context[this.State.mediaType]?.[ttId] || BuildEmptyContext();
  }

  async EnsureSocialTitleContext(titleIds, force = false) {
    const ids = NormalizeTitleIds(titleIds);
    if (!ids.length)
      return false;
    const requested = force ? ids : ids.filter((id) => !Object.hasOwn(this.Social.context[this.State.mediaType], id));
    if (!requested.length)
      return this.ApplySocialContextToCards();
    return await this.RequestSocialTitleContext(requested);
  }

  async RequestSocialTitleContext(titleIds) {
    const mediaType = this.State.mediaType;
    const requestKey = `${mediaType}:${[...titleIds].sort().join(",")}`;
    if (this.Social.contextInFlight.has(requestKey))
      return false;
    this.Social.contextInFlight.add(requestKey);
    try {
      const payload = await this.RequestJson("/api/social/title-context", PostMethod, { mediaType, titleIds });
      return this.ApplySocialTitleContext(mediaType, payload.titles || {});
    } finally {
      this.Social.contextInFlight.delete(requestKey);
    }
  }

  ApplySocialTitleContext(mediaType, titles) {
    this.Social.context[mediaType] = { ...this.Social.context[mediaType], ...titles };
    this.ApplySocialContextToCards();
    if (mediaType === this.State.mediaType && this.SocialFilterIsActive())
      this.RenderRecommendationQueue();
    return true;
  }

  ApplySocialContextToCards() {
    const cards = document.querySelectorAll("[data-ttid]");
    for (const card of cards)
      this.ApplySocialContextToCard(card);
    return Boolean(cards.length);
  }

  ApplySocialContextToCard(card) {
    const poster = card.querySelector(".poster, .recommendation-poster");
    if (!poster)
      return;
    poster.querySelector("[data-social-badges]")?.remove();
    const context = this.ReadSocialTitleContext(card.dataset.ttid);
    const html = RenderSocialBadges(context, this.Social.profile?.showFriendRatings !== false);
    if (html)
      poster.insertAdjacentHTML("beforeend", html);
  }

  async RefreshCurrentSocialContext() {
    const ids = this.ReadCurrentSocialTitleIds();
    if (!ids.length)
      return false;
    return await this.EnsureSocialTitleContext(ids, ForceSocialContextRefresh);
  }

  ReadCurrentSocialTitleIds() {
    const ratingIds = (this.State.queue || []).slice(0, 3).map((item) => item.ttId);
    const recommendationIds = (this.State.recommendationQueue || []).map((item) => item.ttId);
    return NormalizeTitleIds([...ratingIds, ...recommendationIds]).slice(0, 200);
  }
}

function HasSelectedProfile(profiles, selected) {
  return profiles.some((profile) => !selected.size || selected.has(profile.userId));
}

function HasSelectedRating(ratings, selected, minimumRating) {
  return ratings.some((item) => item.rating >= minimumRating && (!selected.size || selected.has(item.profile.userId)));
}

function NormalizeTitleIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((item) => /^tt\d+$/.test(item)))];
}

function ReadCheckedValues(container, name) {
  if (!container)
    return [];
  return [...container.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function BuildEmptyContext() {
  return { ratings: [], sharedBy: [], sharedWith: [] };
}
