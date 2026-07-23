import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { SendText } from "./http.mjs";

const JpegContentType = "image/jpeg";
const ContentTypeValues = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": JpegContentType,
  ".jpeg": JpegContentType,
  ".ico": "image/x-icon"
};
const ContentTypes = Object.freeze(ContentTypeValues);

export async function ServeStaticFile(url, response, rootPath) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(rootPath, `.${requestedPath}`);
  if (!IsSafeStaticPath(filePath, rootPath)) {
    SendText(response, 403, "Forbidden");
    return;
  }
  const isExistingFile = existsSync(filePath) && (await stat(filePath)).isFile();
  if (!isExistingFile) {
    SendText(response, 404, "Not found");
    return;
  }
  response.writeHead(200, BuildStaticHeaders(filePath));
  createReadStream(filePath).pipe(response);
}

function IsSafeStaticPath(filePath, rootPath) {
  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath)
    return true;
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function BuildStaticHeaders(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    "content-type": ContentTypes[extension] || "application/octet-stream",
    "cache-control": "no-store"
  };
}
