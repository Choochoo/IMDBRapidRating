import { z } from "zod";
import { MediaTypes } from "../shared/media.js";
import { NormalizeKeyboardShortcuts, ValidateKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";
import { NormalizeHelpPreferences, ValidateHelpPreferences } from "../shared/help-preferences.js";

export const MovieMediaType = "movie";
export const MineTasteAudience = "mine";
export const CombinedTasteValue = "both";
export const RatedDecisionKind = "rated";
export const NotSeenDecisionKind = "notSeen";
export const WishlistDecisionKind = "wishlist";
export const PendingSubmitStatus = "pending";
export const SkippedSubmitStatus = "skipped";

export const MediaTypeSchema = z.enum(MediaTypes);

const StateFields = {
  payload: z.record(z.string(), z.unknown()),
  ratingsCsv: z.string().max(10 * 1024 * 1024).default(""),
  revision: z.number().int().nonnegative(),
  mediaType: MediaTypeSchema.default(MovieMediaType)
};

export const StateSchema = z.object(StateFields);

const NotSeenFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  titleId: z.string().trim().regex(/^tt\d+$/),
  title: z.string().max(500).default(""),
  year: z.union([z.string(), z.number()]).optional(),
  at: z.string().optional()
};

export const NotSeenSchema = z.object(NotSeenFields);

const RecommendationExclusionFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  ttId: z.string().trim().regex(/^tt\d+$/).or(z.literal("")).default(""),
  title: z.string().trim().min(1).max(500),
  year: z.union([z.string(), z.number()]).optional(),
  at: z.string().optional()
};

export const RecommendationExclusionSchema = z.object(RecommendationExclusionFields);

const RecommendationQueueItemFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  ttId: z.string().trim().regex(/^tt\d+$/),
  title: z.string().trim().min(1).max(500),
  year: z.union([z.string(), z.number()]).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(30).default([])
};

export const RecommendationQueueItemSchema = z.object(RecommendationQueueItemFields);

const RaterDecisionFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  actionId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  kind: z.enum([RatedDecisionKind, NotSeenDecisionKind, WishlistDecisionKind]),
  titleId: z.string().trim().regex(/^tt\d+$/),
  title: z.string().trim().min(1).max(500),
  year: z.union([z.string(), z.number()]).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  rating: z.number().int().min(1).max(10).nullable().optional(),
  at: z.string().optional()
};

function ValidateRaterDecision(value, context) {
  if (value.kind === RatedDecisionKind && !Number.isInteger(value.rating))
    context.addIssue({ code: "custom", path: ["rating"], message: "A rating is required." });
}

export const RaterDecisionSchema = z.object(RaterDecisionFields).superRefine(ValidateRaterDecision);

const RaterUndoFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  actionId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  titleId: z.string().trim().regex(/^tt\d+$/)
};

export const RaterUndoSchema = z.object(RaterUndoFields);

const QuickRatingFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  actionId: z.string().uuid(),
  titleId: z.string().trim().regex(/^tt\d+$/),
  rating: z.number().int().min(1).max(10),
  at: z.string().optional()
};

export const QuickRatingSchema = z.object(QuickRatingFields);

const RateFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  titleId: z.string().trim().regex(/^tt\d+$/),
  rating: z.number().int().min(1).max(10),
  title: z.string().trim().max(500).default(""),
  year: z.union([z.string(), z.number()]).optional(),
  at: z.string().optional()
};

export const RateSchema = z.object(RateFields);

const DeleteRateFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  titleId: z.string().trim().regex(/^tt\d+$/),
  deferAccountState: z.boolean().default(false)
};

export const DeleteRateSchema = z.object(DeleteRateFields);

const RaterQueueRestoreFields = {
  mediaType: MediaTypeSchema.default(MovieMediaType),
  expectedRevision: z.number().int().positive(),
  queueIds: z.array(z.string().trim().regex(/^tt\d+$/)).max(100_000)
};

export const RaterQueueRestoreSchema = z.object(RaterQueueRestoreFields);

const SecretFields = {
  value: z.string().trim().min(1).max(64 * 1024)
};

export const SecretSchema = z.object(SecretFields);

const SocialTasteFields = {
  audience: z.enum([MineTasteAudience, "friends", CombinedTasteValue]).default(MineTasteAudience),
  friendIds: z.array(z.string().uuid()).max(20).default([])
};

export const SocialTasteSchema = z.object(SocialTasteFields);

function AreKeyboardShortcutsValid(value) {
  return ValidateKeyboardShortcuts(value).ok;
}

const KeyboardShortcutsSchema = z.record(z.string(), z.string()).refine(AreKeyboardShortcutsValid, { message: "Keyboard shortcuts are invalid." }).transform(NormalizeKeyboardShortcuts);

function AreHelpPreferencesValid(value) {
  return ValidateHelpPreferences(value).ok;
}

const HelpPreferencesSchema = z.unknown().refine(AreHelpPreferencesValid, { message: "Helpful reminder preferences are invalid." }).transform(NormalizeHelpPreferences);

const PreferencesFields = {
  streamingCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  keyboardShortcuts: KeyboardShortcutsSchema.optional(),
  helpPreferences: HelpPreferencesSchema.optional()
};

export const PreferencesSchema = z.object(PreferencesFields);

const AiConnectionFields = {
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().max(64 * 1024).default("")
};

export const AiConnectionSchema = z.object(AiConnectionFields);

const AiSettingsFields = {
  model: z.string().trim().min(1).max(512)
};

export const AiSettingsSchema = AiConnectionSchema.extend(AiSettingsFields);
