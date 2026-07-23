import { z } from "zod";
import { MediaTypes } from "../shared/media.js";

const MediaTypeSchema = z.enum(MediaTypes);
export const UserIdSchema = z.string().uuid();
export const HandleSchema = z.string().trim().toLowerCase().min(3, "Username must contain at least 3 characters.").max(32, "Username cannot exceed 32 characters.").regex(/^[a-z0-9][a-z0-9._-]+$/, "Use letters, numbers, periods, underscores, or hyphens.");
export const ProfileSchema = z.object({ displayName: z.string().trim().min(1).max(80), searchable: z.boolean(), shareRatingsWithFriends: z.boolean(), showFriendRatings: z.boolean() });
export const UsernameSchema = z.object({ handle: HandleSchema });
export const SearchSchema = z.object({ q: z.string().trim().min(2).max(80) });
export const FriendRequestSchema = z.object({ userId: UserIdSchema });
export const SocialContextSchema = z.object({ mediaType: MediaTypeSchema, titleIds: z.array(z.string().regex(/^tt\d+$/)).min(1).max(200) });
export const ShareSchema = z.object({ mediaType: MediaTypeSchema, ttId: z.string().regex(/^tt\d+$/), recipientIds: z.array(UserIdSchema).min(1).max(20) });
