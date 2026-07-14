export function SendText(response, status, body) {
  response.writeHead(status, BuildContentHeaders("text/plain;charset=utf-8"));
  response.end(body);
}

export function SendContent(response, status, body, contentType) {
  response.writeHead(status, BuildContentHeaders(contentType));
  response.end(body);
}

export function SendJson(response, status, payload) {
  response.writeHead(status, BuildJsonHeaders());
  response.end(JSON.stringify(payload));
}

export async function ReadJsonBody(request, maxBytes = 16 * 1024) {
  const body = await ReadTextBody(request, maxBytes);
  return ParseJsonBody(body);
}

export async function ReadTextBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes)
      throw BuildHttpError("Request body too large.", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function ParseJsonBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw BuildHttpError("Request body must be JSON.", 400);
  }
}

function BuildContentHeaders(contentType) {
  return {
    "content-type": contentType
  };
}

function BuildJsonHeaders() {
  return {
    "content-type": "application/json;charset=utf-8",
    "cache-control": "no-store"
  };
}

function BuildHttpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}
