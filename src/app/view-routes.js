import { AiSettingsView, AiView, FriendsView, MovieMediaType, RaterView, SettingsView, SyncView, TvMediaType } from "./app-constants.js";

const MoviesPathSegment = "movies";
const RatePathSegment = "rate";
const RootPath = "/";
const CanonicalViewPathPattern = /^\/(movies|tv)\/(rate|wishlist|sync|friends)$/;
const PathSegmentByView = Object.freeze({ [RaterView]: RatePathSegment, [AiView]: "wishlist", [SyncView]: SyncView, [FriendsView]: FriendsView });
export const LoginPath = "/login";
export const SettingsPath = "/settings";
export const ShortcutSettingsPath = "/settings/shortcuts";
export const AiSettingsPath = "/settings/ai";

export function PathForView(view, mediaType = MovieMediaType) {
  if (view === AiSettingsView)
    return AiSettingsPath;
  if (view === SettingsView)
    return SettingsPath;
  const media = mediaType === TvMediaType ? TvMediaType : MoviesPathSegment;
  const safeView = mediaType === TvMediaType && view === SyncView ? RaterView : view;
  return `/${media}/${PathSegmentByView[safeView] || PathSegmentByView[RaterView]}`;
}

export function ViewFromPathname(pathname) {
  return RouteFromPathname(pathname).view;
}

export function MediaTypeFromPathname(pathname) {
  return RouteFromPathname(pathname).mediaType;
}

export function RouteFromPathname(pathname) {
  const path = NormalizePath(pathname);
  const mediaType = path.startsWith(`/${TvMediaType}/`) ? TvMediaType : MovieMediaType;
  if (MatchesRouteSegment(path, FriendsView))
    return { mediaType, view: FriendsView };
  if (path === AiSettingsPath)
    return { mediaType, view: AiSettingsView };
  if (path === SettingsPath || path === ShortcutSettingsPath)
    return { mediaType, view: SettingsView };
  if (MatchesRouteSegment(path, PathSegmentByView[AiView]))
    return { mediaType, view: AiView };
  if (mediaType === MovieMediaType && MatchesRouteSegment(path, SyncView))
    return { mediaType, view: SyncView };
  return { mediaType, view: RaterView };
}

export function IsCanonicalViewPath(pathname) {
  const path = NormalizePath(pathname);
  if ([AiSettingsPath, SettingsPath, ShortcutSettingsPath].includes(path))
    return true;
  return CanonicalViewPathPattern.test(path) && path !== `/${TvMediaType}/${SyncView}`;
}

export function IsLoginPath(pathname) {
  return NormalizePath(pathname) === LoginPath;
}

function NormalizePath(value) {
  const path = String(value || RootPath).toLowerCase().replace(/\/+$/, "");
  return path || RootPath;
}

function MatchesRouteSegment(path, segment) {
  return path.endsWith(`/${segment}`) || path === `/${segment}`;
}
