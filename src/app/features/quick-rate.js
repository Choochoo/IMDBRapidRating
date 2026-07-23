import { Config } from "../config.js";
import { EscapeHtml } from "../util.js";

const MaximumResults = 6;
const MinimumSearchLength = 2;
const RatedStatus = "rated";
const PutMethod = "PUT";
const AriaExpandedAttribute = "aria-expanded";
const AriaActiveDescendantAttribute = "aria-activedescendant";
const ArrowDownKey = "ArrowDown";
const EnterKey = "Enter";
const FalseValue = "false";
const SpaceSeparator = " ";

export class QuickRateFeature {
  InitializeQuickRateState() {
    this.QuickRateSelection = null;
    this.QuickRateMatches = [];
    this.QuickRateActiveIndex = -1;
  }

  HandleQuickRateMenuToggle() {
    if (!this.Elements.quickRateMenu.open)
      return this.ResetQuickRateForm();
    window.setTimeout(() => this.Elements.quickRateSearch.focus(), 0);
  }

  HandleQuickRateSearchInput() {
    this.ClearQuickRateSelection();
    const query = this.Elements.quickRateSearch.value;
    this.QuickRateMatches = SearchQuickRateTitles(this.State.movies, query);
    this.QuickRateActiveIndex = -1;
    this.RenderQuickRateResults(query);
  }

  RenderQuickRateResults(query) {
    const hasQuery = String(query || "").trim().length >= MinimumSearchLength;
    this.Elements.quickRateResults.hidden = !hasQuery;
    this.Elements.quickRateSearch.setAttribute(AriaExpandedAttribute, String(hasQuery));
    if (!hasQuery)
      return this.ClearQuickRateResults();
    this.Elements.quickRateResults.innerHTML = this.QuickRateMatches.length ? this.QuickRateMatches.map((movie, index) => this.RenderQuickRateResult(movie, index)).join("") : `<p class="quick-rate-empty">No matching title is in this catalog.</p>`;
  }

  RenderQuickRateResult(movie, index) {
    const year = movie.year ? `<small>${EscapeHtml(movie.year)}</small>` : "";
    const status = this.ReadQuickRateTitleStatus(movie);
    const statusHtml = status ? `<em>${EscapeHtml(status)}</em>` : "";
    return `<button type="button" id="quick-rate-option-${index}" class="quick-rate-result" role="option" aria-selected="false" data-quick-rate-id="${EscapeHtml(movie.ttId)}"><span><strong>${EscapeHtml(movie.title)}</strong>${year}</span>${statusHtml}</button>`;
  }

  ReadQuickRateTitleStatus(movie) {
    const record = this.State.ratings[movie.ttId];
    if (record?.status === RatedStatus || record?.status === "imported")
      return `Rated ${record.rating}/10`;
    const saved = this.State.recommendationQueue.some((item) => item.ttId === movie.ttId);
    return saved ? "On watchlist" : "";
  }

  ClearQuickRateResults() {
    this.Elements.quickRateResults.innerHTML = "";
    this.Elements.quickRateSearch.removeAttribute(AriaActiveDescendantAttribute);
  }

  HandleQuickRateResultsClick(event) {
    const option = event.target.closest?.("[data-quick-rate-id]");
    if (option)
      this.SelectQuickRateTitle(option.dataset.quickRateId);
  }

  HandleQuickRateSearchKey(event) {
    if (![ArrowDownKey, "ArrowUp", EnterKey].includes(event.key))
      return;
    event.preventDefault();
    if (event.key === EnterKey)
      return this.SelectActiveQuickRateTitle();
    this.MoveQuickRateActiveOption(event.key === ArrowDownKey ? 1 : -1);
  }

  MoveQuickRateActiveOption(direction) {
    if (!this.QuickRateMatches.length)
      return;
    const next = this.QuickRateActiveIndex + direction;
    this.QuickRateActiveIndex = (next + this.QuickRateMatches.length) % this.QuickRateMatches.length;
    this.UpdateQuickRateActiveOption();
  }

  UpdateQuickRateActiveOption() {
    const options = [...this.Elements.quickRateResults.querySelectorAll("[role='option']")];
    for (const [index, option] of options.entries())
      option.setAttribute("aria-selected", String(index === this.QuickRateActiveIndex));
    const active = options[this.QuickRateActiveIndex];
    if (active)
      this.Elements.quickRateSearch.setAttribute(AriaActiveDescendantAttribute, active.id);
  }

  SelectActiveQuickRateTitle() {
    const movie = this.QuickRateMatches[this.QuickRateActiveIndex];
    if (movie)
      this.SelectQuickRateTitle(movie.ttId);
  }

  SelectQuickRateTitle(ttId) {
    const movie = this.State.movieById.get(ttId);
    if (!movie)
      return;
    this.QuickRateSelection = movie;
    this.Elements.quickRateSearch.value = `${movie.title}${movie.year ? ` (${movie.year})` : ""}`;
    this.RenderQuickRateSelection(movie);
    this.HideQuickRateResults();
    this.Elements.quickRateRating.focus();
  }

  RenderQuickRateSelection(movie) {
    const year = movie.year ? ` (${EscapeHtml(movie.year)})` : "";
    this.Elements.quickRateSelection.innerHTML = `<span><strong>${EscapeHtml(movie.title)}</strong>${year}</span><small>${EscapeHtml(movie.ttId)}</small>`;
    this.Elements.quickRateSelection.hidden = false;
    this.UpdateQuickRateSubmitState();
  }

  HideQuickRateResults() {
    this.Elements.quickRateResults.hidden = true;
    this.Elements.quickRateSearch.setAttribute(AriaExpandedAttribute, FalseValue);
    this.Elements.quickRateSearch.removeAttribute(AriaActiveDescendantAttribute);
  }

  ClearQuickRateSelection() {
    this.QuickRateSelection = null;
    this.Elements.quickRateSelection.hidden = true;
    this.Elements.quickRateSelection.innerHTML = "";
    this.UpdateQuickRateSubmitState();
  }

  UpdateQuickRateSubmitState() {
    const rating = Number(this.Elements.quickRateRating.value);
    const validRating = Number.isInteger(rating) && rating >= 1 && rating <= 10;
    this.Elements.quickRateSubmit.disabled = !this.QuickRateSelection || !validRating || this.State.locked;
  }

  async HandleQuickRateSubmit(event) {
    event.preventDefault();
    this.ShowQuickRateError("");
    if (!this.State.live.configured)
      return this.RequireQuickRateImdbConnection();
    if (!this.CanSubmitQuickRating())
      return this.ShowQuickRateError("Choose a title and enter a whole-number rating from 1 to 10.");
    await this.SubmitQuickRating();
  }

  RequireQuickRateImdbConnection() {
    this.ShowQuickRateError("Connect IMDb before sending a quick rating.");
    this.ShowImdbDialog();
  }

  CanSubmitQuickRating() {
    const rating = Number(this.Elements.quickRateRating.value);
    return Boolean(this.QuickRateSelection) && Number.isInteger(rating) && rating >= 1 && rating <= 10 && !this.State.locked;
  }

  async SubmitQuickRating() {
    const movie = this.QuickRateSelection;
    const rating = Number(this.Elements.quickRateRating.value);
    this.BeginQuickRateSubmit();
    try {
      await this.CommitQuickRating(movie, rating);
      this.CompleteQuickRateSubmit(movie, rating);
    } catch (error) {
      this.ShowQuickRateError(error.message || "The rating could not be saved.");
    } finally {
      this.EndQuickRateSubmit();
    }
  }

  BeginQuickRateSubmit() {
    this.State.locked = true;
    this.Elements.quickRateSubmit.disabled = true;
    this.Elements.quickRateSubmit.textContent = "Saving…";
  }

  async CommitQuickRating(movie, rating) {
    const request = this.BuildQuickRateRequest(movie, rating);
    const payload = await this.RequestJson(Config.quickRatingUrl, PutMethod, request);
    this.ApplyQuickRatingCommit(payload, movie);
  }

  BuildQuickRateRequest(movie, rating) {
    return {
      mediaType: this.State.mediaType,
      actionId: this.NewActionId(),
      titleId: movie.ttId,
      rating,
      at: new Date().toISOString()
    };
  }

  ApplyQuickRatingCommit(payload, movie) {
    this.State.recommendationQueue = this.NormalizeRecommendationQueue(payload.recommendations);
    this.ApplyCommittedDecision(payload, movie);
    this.RenderRecommendationQueue();
    this.UpdateRecommendationStatus();
  }

  CompleteQuickRateSubmit(movie, rating) {
    this.ShowToast(`<strong>${EscapeHtml(movie.title)}</strong> saved as ${rating}/10 and queued for IMDb`);
    this.Elements.quickRateMenu.open = false;
  }

  EndQuickRateSubmit() {
    this.State.locked = false;
    this.Elements.quickRateSubmit.textContent = "Rate here and on IMDb";
    this.UpdateQuickRateSubmitState();
    this.Render();
  }

  ShowQuickRateError(message) {
    this.Elements.quickRateError.textContent = message || "";
  }

  ResetQuickRateForm() {
    this.Elements.quickRateForm.reset();
    this.QuickRateMatches = [];
    this.QuickRateActiveIndex = -1;
    this.ClearQuickRateSelection();
    this.ClearQuickRateResults();
    this.Elements.quickRateResults.hidden = true;
    this.Elements.quickRateSearch.setAttribute(AriaExpandedAttribute, FalseValue);
    this.ShowQuickRateError("");
  }
}

export function SearchQuickRateTitles(movies, query, maximum = MaximumResults) {
  const criteria = BuildSearchCriteria(query);
  if (!criteria)
    return [];
  const matches = [];
  for (const movie of Array.isArray(movies) ? movies : []) {
    const score = ScoreQuickRateTitle(movie, criteria);
    if (score >= 0)
      matches.push({ movie, score });
  }
  return matches.sort(CompareQuickRateMatches).slice(0, maximum).map((match) => match.movie);
}

function BuildSearchCriteria(value) {
  const raw = String(value || "").trim();
  if (raw.length < MinimumSearchLength)
    return null;
  const id = raw.match(/tt\d+/i)?.[0]?.toLowerCase() || "";
  const year = Number(raw.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0]) || null;
  const text = NormalizeQuickRateText(raw.replace(/https?:\/\/\S+/gi, SpaceSeparator).replace(/tt\d+/gi, SpaceSeparator).replace(/\b(?:18|19|20|21)\d{2}\b/g, SpaceSeparator));
  const words = text.split(SpaceSeparator).filter(Boolean);
  return { id, year, text, words };
}

function ScoreQuickRateTitle(movie, criteria) {
  if (criteria.id)
    return String(movie?.ttId || "").toLowerCase() === criteria.id ? 0 : -1;
  if (!criteria.words.length)
    return -1;
  if (criteria.year && Number(movie?.year) !== criteria.year)
    return -1;
  const title = NormalizeQuickRateText(movie?.title);
  if (!criteria.words.every((word) => title.includes(word)))
    return -1;
  if (title === criteria.text)
    return 0;
  return title.startsWith(criteria.text) ? 1 : 2;
}

function CompareQuickRateMatches(left, right) {
  const score = left.score - right.score;
  if (score)
    return score;
  const votes = Number(right.movie?.numVotes) - Number(left.movie?.numVotes);
  if (votes)
    return votes;
  return String(left.movie?.title || "").localeCompare(String(right.movie?.title || ""));
}

function NormalizeQuickRateText(value) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, SpaceSeparator).trim();
}
