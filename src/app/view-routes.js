const PathsByView = Object.freeze({
  rater: "/rate",
  ai: "/wishlist",
  sync: "/sync"
});

export function PathForView(view) {
  return PathsByView[view] || PathsByView.rater;
}

export function ViewFromPathname(pathname) {
  const path = NormalizePath(pathname);
  if (path === PathsByView.ai)
    return "ai";
  if (path === PathsByView.sync)
    return "sync";
  return "rater";
}

function NormalizePath(value) {
  const path = String(value || "/").toLowerCase().replace(/\/+$/, "");
  return path || "/";
}
