import { ApplyAvatar, RenderFriendCheckboxes, RenderPeople, RenderSearchResults } from "../social-rendering.js";
import { ChangeEvent, ClickEvent, KeydownEvent, PostMethod, PutMethod, SubmitEvent } from "../app-constants.js";
import { EscapeHtml, FormatCount } from "../util.js";

const AvatarContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const MaximumAvatarBytes = 1024 * 1024;
const AcceptFriendAction = "accept";
const BlockFriendAction = "block";
const DeleteMethod = "DELETE";
const DeleteFriendAction = "delete";
const ForceSocialContextRefresh = true;
const FriendsApiUrl = "/api/friends";
const FriendsLabel = "friends";
const IncomingFriendsMode = "incoming";
const OutgoingFriendsMode = "outgoing";
const ProfileApiUrl = "/api/profile";
const ProfileUsernameApiUrl = "/api/profile/username";
const RecommendationFriendName = "recommendation-friend";
const RequestFriendAction = "request";
const ShareFriendName = "share-friend";
const SocialFilterFriendName = "social-filter-friend";
const UsernamePendingLabel = "Choose username";

export class FriendsFeature {
  InitializeSocialState() {
    this.Social = {
      profile: null,
      friends: [],
      incoming: [],
      outgoing: [],
      context: { movie: {}, tv: {} },
      contextInFlight: new Set(),
      filterMode: "all",
      filterFriendIds: [],
      pendingShare: null,
      shareTrigger: null
    };
  }

  async LoadSocialState() {
    const [profilePayload, friendPayload] = await Promise.all([this.FetchJson(ProfileApiUrl), this.FetchJson(FriendsApiUrl)]);
    this.ApplySocialState(profilePayload.profile, friendPayload);
  }

  ApplySocialState(profile, relationships) {
    this.Social.profile = profile;
    this.ApplyFriendships(relationships);
    this.RenderProfile();
    this.RenderFriendLists();
    this.RenderFriendSelectors();
  }

  ApplyFriendships(payload) {
    this.Social.friends = Array.isArray(payload.friends) ? payload.friends : [];
    this.Social.incoming = Array.isArray(payload.incoming) ? payload.incoming : [];
    this.Social.outgoing = Array.isArray(payload.outgoing) ? payload.outgoing : [];
    this.UpdateFriendRequestCount();
  }

  BindFriendEvents() {
    this.Elements.profileForm.addEventListener(SubmitEvent, (event) => this.HandleProfileSave(event));
    this.Elements.usernameForm.addEventListener(SubmitEvent, (event) => this.HandleUsernameSave(event));
    this.Elements.profileAvatarFile.addEventListener(ChangeEvent, (event) => this.HandleAvatarFile(event));
    this.Elements.profileAvatarRemove.addEventListener(ClickEvent, () => this.RemoveAvatar().catch((error) => this.ShowProfileError(error.message)));
    this.Elements.friendSearchForm.addEventListener(SubmitEvent, (event) => this.HandleFriendSearch(event));
    this.Elements.friendsView.addEventListener(ClickEvent, (event) => this.HandleFriendAction(event));
    this.BindShareEvents();
    this.BindSocialContextEvents();
  }

  BindShareEvents() {
    this.Elements.shareForm.addEventListener(SubmitEvent, (event) => this.HandleShareSubmit(event));
    this.Elements.shareCancel.addEventListener(ClickEvent, () => this.HideShareDialog());
    this.Elements.shareDialog.addEventListener(ClickEvent, (event) => this.HandleShareBackdrop(event));
    document.addEventListener(KeydownEvent, (event) => this.HandleShareKey(event));
  }

  RenderProfile() {
    const profile = this.Social.profile;
    if (!profile)
      return;
    this.RenderProfileFields(profile);
    this.RenderProfileIdentity(profile);
    this.RenderUsernameDialog(profile);
  }

  RenderProfileFields(profile) {
    this.Elements.profileDisplayName.value = profile.displayName;
    this.Elements.profileHandle.value = profile.handleChosen ? profile.handle : UsernamePendingLabel;
    this.Elements.profileSearchable.checked = profile.searchable;
    this.Elements.profileShareRatings.checked = profile.shareRatingsWithFriends;
    this.Elements.profileShowRatings.checked = profile.showFriendRatings;
    this.Elements.profileAvatarRemove.hidden = !profile.avatarUrl;
  }

  RenderProfileIdentity(profile) {
    this.Elements.accountBadge.textContent = profile.handleChosen ? `@${profile.handle}` : UsernamePendingLabel;
    this.Elements.accountBadge.hidden = false;
    ApplyAvatar(this.Elements.profileAvatarPreview, profile);
  }

  RenderUsernameDialog(profile) {
    const required = !profile.handleChosen;
    this.Elements.usernameDialog.hidden = !required;
    if (required)
      window.setTimeout(() => this.Elements.usernameInput.focus(), 0);
  }

  RenderFriendLists() {
    this.RenderFriendGroup(IncomingFriendsMode, this.Social.incoming);
    this.RenderFriendGroup(OutgoingFriendsMode, this.Social.outgoing);
    this.Elements.acceptedFriends.innerHTML = RenderPeople(this.Social.friends, FriendsLabel);
    this.Elements.acceptedFriendsCount.textContent = FormatCount(this.Social.friends.length);
  }

  RenderFriendGroup(mode, items) {
    const incoming = mode === IncomingFriendsMode;
    const section = incoming ? this.Elements.incomingFriendsSection : this.Elements.outgoingFriendsSection;
    const container = incoming ? this.Elements.incomingFriends : this.Elements.outgoingFriends;
    const count = incoming ? this.Elements.incomingFriendsCount : this.Elements.outgoingFriendsCount;
    section.hidden = !items.length;
    container.innerHTML = RenderPeople(items, mode);
    count.textContent = FormatCount(items.length);
  }

  RenderFriendSelectors() {
    const tasteSelected = ReadCheckedValues(this.Elements.recommendationFriendOptions, RecommendationFriendName);
    const filterSelected = ReadCheckedValues(this.Elements.socialFilterFriends, SocialFilterFriendName);
    this.Elements.recommendationFriendOptions.innerHTML = RenderFriendCheckboxes(this.Social.friends, RecommendationFriendName, tasteSelected);
    this.Elements.socialFilterFriends.innerHTML = RenderFriendCheckboxes(this.Social.friends, SocialFilterFriendName, filterSelected);
    this.UpdateRecommendationAudienceControl();
  }

  UpdateFriendRequestCount() {
    const count = this.Social.incoming.length;
    this.Elements.friendRequestCount.hidden = !count;
    this.Elements.friendRequestCount.textContent = FormatCount(count);
  }

  async RefreshFriendships() {
    const payload = await this.FetchJson(FriendsApiUrl);
    this.ApplyFriendships(payload);
    this.RenderFriendLists();
    this.RenderFriendSelectors();
    return true;
  }

  HandleProfileSave(event) {
    event.preventDefault();
    this.SaveProfile().catch((error) => this.ShowProfileError(error.message));
  }

  HandleUsernameSave(event) {
    event.preventDefault();
    this.ClaimUsername().catch((error) => this.ShowUsernameError(error.message));
  }

  async ClaimUsername() {
    this.SetUsernameSaving(true);
    this.ShowUsernameError("");
    try {
      const payload = await this.RequestJson(ProfileUsernameApiUrl, PutMethod, { handle: this.Elements.usernameInput.value });
      this.Social.profile = payload.profile;
      this.RenderProfile();
      this.ShowToast("Your permanent username was saved.");
    } finally {
      this.SetUsernameSaving(false);
    }
  }

  SetUsernameSaving(value) {
    this.Elements.usernameSubmit.disabled = value;
    this.Elements.usernameSubmit.textContent = value ? "Saving..." : "Save permanent username";
  }

  ShowUsernameError(message) {
    this.Elements.usernameError.textContent = message || "";
  }

  async SaveProfile() {
    this.SetProfileSaving(true);
    this.ShowProfileError("");
    try {
      const payload = await this.RequestJson(ProfileApiUrl, PutMethod, this.BuildProfileRequest());
      this.Social.profile = payload.profile;
      this.RenderProfile();
      this.ApplySocialContextToCards();
      this.ShowToast("Your profile was updated.");
    } finally {
      this.SetProfileSaving(false);
    }
  }

  BuildProfileRequest() {
    return {
      displayName: this.Elements.profileDisplayName.value,
      searchable: this.Elements.profileSearchable.checked,
      shareRatingsWithFriends: this.Elements.profileShareRatings.checked,
      showFriendRatings: this.Elements.profileShowRatings.checked
    };
  }

  SetProfileSaving(value) {
    this.Elements.profileSave.disabled = value;
    this.Elements.profileSave.textContent = value ? "Saving..." : "Save profile";
  }

  ShowProfileError(message) {
    this.Elements.profileError.textContent = message || "";
  }

  HandleAvatarFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file)
      return;
    this.UploadAvatar(file).catch((error) => this.ShowProfileError(error.message));
  }

  async UploadAvatar(file) {
    ValidateAvatarFile(file);
    const payload = await this.RequestAvatar(PutMethod, file);
    this.ApplyAvatarPayload(payload);
    this.ShowToast("Your profile photo was updated.");
  }

  async RemoveAvatar() {
    const payload = await this.RequestAvatar(DeleteMethod);
    this.ApplyAvatarPayload(payload);
    this.ShowToast("Your profile photo was removed.");
  }

  async RequestAvatar(method, file = null) {
    const headers = { "x-csrf-token": this.CsrfToken };
    if (file)
      headers["content-type"] = file.type;
    const response = await fetch(`${ProfileApiUrl}/avatar`, { method, headers, body: file });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error || "The profile photo could not be saved.");
    return payload;
  }

  ApplyAvatarPayload(payload) {
    this.Social.profile = { ...this.Social.profile, avatarVersion: payload.avatarVersion, avatarUrl: payload.avatarUrl || "" };
    this.RenderProfile();
    this.RenderFriendSelectors();
    this.ApplySocialContextToCards();
  }

  HandleFriendSearch(event) {
    event.preventDefault();
    this.SearchFriends().catch((error) => this.ShowFriendSearchError(error.message));
  }

  async SearchFriends() {
    const query = this.Elements.friendSearchInput.value.trim();
    this.SetFriendSearchLoading(true);
    this.ShowFriendSearchError("");
    try {
      const payload = await this.FetchJson(`${FriendsApiUrl}/search?q=${encodeURIComponent(query)}`);
      this.Elements.friendSearchResults.innerHTML = RenderSearchResults(payload.results || []);
    } finally {
      this.SetFriendSearchLoading(false);
    }
  }

  SetFriendSearchLoading(value) {
    this.Elements.friendSearchSubmit.disabled = value;
    this.Elements.friendSearchSubmit.textContent = value ? "Searching..." : "Search";
  }

  ShowFriendSearchError(message) {
    this.Elements.friendSearchError.textContent = message || "";
  }

  HandleFriendAction(event) {
    const target = event.target?.closest?.("button");
    if (!target)
      return;
    const action = ReadFriendAction(target);
    if (!action)
      return;
    if (!ConfirmFriendAction(action))
      return;
    this.RunFriendAction(action).catch((error) => this.ShowToast(EscapeHtml(error.message)));
  }

  async RunFriendAction(action) {
    if (action.kind === RequestFriendAction)
      await this.RequestFriend(action.value);
    if (action.kind === AcceptFriendAction)
      await this.AcceptFriend(action.value);
    if (action.kind === DeleteFriendAction)
      await this.DeleteFriend(action.value);
    if (action.kind === BlockFriendAction)
      await this.BlockFriend(action.value);
    await this.FinishFriendAction();
  }

  async RequestFriend(userId) {
    await this.RequestJson(`${FriendsApiUrl}/requests`, PostMethod, { userId });
    this.ShowToast("Friend request sent.");
  }

  async AcceptFriend(relationshipId) {
    await this.RequestJson(`${FriendsApiUrl}/requests/${relationshipId}/accept`, PutMethod, {});
    this.ShowToast("Friend request accepted.");
  }

  async DeleteFriend(relationshipId) {
    await this.RequestJson(`${FriendsApiUrl}/relationships/${relationshipId}`, DeleteMethod, {});
    this.ShowToast("The friend connection was removed.");
  }

  async BlockFriend(userId) {
    await this.RequestJson(`${FriendsApiUrl}/${userId}/block`, PostMethod, {});
    this.ShowToast("That user was blocked.");
  }

  async FinishFriendAction() {
    this.Elements.friendSearchResults.innerHTML = "";
    await this.RefreshFriendships();
    await this.RefreshCurrentSocialContext();
  }

  OpenShareDialog(element) {
    const item = this.FindRecommendationFromElement(element);
    if (!item)
      return;
    this.Social.pendingShare = item;
    this.Social.shareTrigger = element;
    this.Elements.shareDialogTitle.textContent = `Share ${item.title}`;
    this.Elements.shareFriendOptions.innerHTML = RenderFriendCheckboxes(this.Social.friends, ShareFriendName);
    this.Elements.shareError.textContent = "";
    this.Elements.shareSubmit.disabled = !this.Social.friends.length;
    this.Elements.shareDialog.hidden = false;
    this.Elements.shareCancel.focus();
  }

  HideShareDialog() {
    const trigger = this.Social.shareTrigger;
    this.Elements.shareDialog.hidden = true;
    this.Elements.shareError.textContent = "";
    this.Social.pendingShare = null;
    this.Social.shareTrigger = null;
    if (trigger?.isConnected)
      trigger.focus();
  }

  HandleShareSubmit(event) {
    event.preventDefault();
    this.SharePendingRecommendation().catch((error) => this.ShowShareError(error.message));
  }

  async SharePendingRecommendation() {
    const item = this.Social.pendingShare;
    const recipientIds = ReadCheckedValues(this.Elements.shareFriendOptions, ShareFriendName);
    if (!item || !recipientIds.length)
      throw new Error("Select at least one friend.");
    this.SetShareSaving(true);
    try {
      const payload = await this.RequestJson("/api/social/share", PostMethod, { mediaType: this.State.mediaType, ttId: item.ttId, recipientIds });
      this.CompleteShare(payload);
    } finally {
      this.SetShareSaving(false);
    }
  }

  CompleteShare(payload) {
    const results = Array.isArray(payload.results) ? payload.results : [];
    const added = results.filter((item) => ["added", "already-saved"].includes(item.status)).length;
    const titleId = this.Social.pendingShare?.ttId;
    this.HideShareDialog();
    if (titleId)
      this.EnsureSocialTitleContext([titleId], ForceSocialContextRefresh).catch(() => null);
    this.ShowToast(BuildShareCompletionMessage(added, results.length));
  }

  SetShareSaving(value) {
    this.Elements.shareSubmit.disabled = value;
    this.Elements.shareSubmit.textContent = value ? "Sharing..." : "Share recommendation";
  }

  ShowShareError(message) {
    this.Elements.shareError.textContent = message || "";
  }

  HandleShareBackdrop(event) {
    if (event.target === this.Elements.shareDialog)
      this.HideShareDialog();
  }

  HandleShareKey(event) {
    if (event.key === "Escape" && !this.Elements.shareDialog.hidden)
      this.HideShareDialog();
  }
}

function ValidateAvatarFile(file) {
  if (!AvatarContentTypes.has(file.type))
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (!file.size || file.size > MaximumAvatarBytes)
    throw new Error("Profile photos must be no larger than 1 MB.");
}

function ReadFriendAction(button) {
  if (button.dataset.friendRequest)
    return { kind: RequestFriendAction, value: button.dataset.friendRequest };
  if (button.dataset.friendAccept)
    return { kind: AcceptFriendAction, value: button.dataset.friendAccept };
  if (button.dataset.friendDelete)
    return { kind: DeleteFriendAction, value: button.dataset.friendDelete };
  if (button.dataset.friendBlock)
    return { kind: BlockFriendAction, value: button.dataset.friendBlock };
  return null;
}

function ReadCheckedValues(container, name) {
  const selector = `input[name="${name}"]:checked`;
  return [...container.querySelectorAll(selector)].map((input) => input.value);
}

function ConfirmFriendAction(action) {
  if (action.kind !== BlockFriendAction)
    return true;
  return window.confirm("Block this user? You will no longer be able to find or friend each other.");
}

function BuildShareCompletionMessage(added, total) {
  if (!added)
    return "No recommendations were delivered. Those friends may have already rated or excluded this title.";
  const noun = added === 1 ? "friend" : FriendsLabel;
  const skipped = total - added;
  const suffix = skipped ? ` ${FormatCount(skipped)} could not receive it.` : "";
  return `Shared with <strong>${FormatCount(added)}</strong> ${noun}.${suffix}`;
}
