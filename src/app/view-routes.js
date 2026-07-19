const SuffixByView = Object.freeze({ rater: "rate", ai: "wishlist", sync: "sync" });

export function PathForView(view, mediaType = "movie") {
  const media = mediaType === "tv" ? "tv" : "movies";
  const safeView = mediaType === "tv" && view === "sync" ? "rater" : view;
  return `/${media}/${SuffixByView[safeView] || SuffixByView.rater}`;
}

export function ViewFromPathname(pathname) {
  return RouteFromPathname(pathname).view;
}

export function MediaTypeFromPathname(pathname) {
  return RouteFromPathname(pathname).mediaType;
}

export function RouteFromPathname(pathname) {
  const path = NormalizePath(pathname);
  const mediaType = path.startsWith("/tv/") ? "tv" : "movie";
  if (path.endsWith("/wishlist") || path === "/wishlist")
    return { mediaType, view: "ai" };
  if (mediaType === "movie" && (path.endsWith("/sync") || path === "/sync"))
    return { mediaType, view: "sync" };
  return { mediaType, view: "rater" };
}

export function IsCanonicalViewPath(pathname) {
  const path = NormalizePath(pathname);
  return /^\/(movies|tv)\/(rate|wishlist|sync)$/.test(path) && !(path === "/tv/sync");
}

function NormalizePath(value) {
  const path = String(value || "/").toLowerCase().replace(/\/+$/, "");
  return path || "/";
}
