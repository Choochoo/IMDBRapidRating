const HeartbeatIntervalMs = 25_000;
const MovieMediaType = "movie";
const TelevisionMediaType = "tv";
const EventStreamHeaderValues = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no"
};
const EventStreamHeaders = Object.freeze(EventStreamHeaderValues);

export function CreateRaterEvents() {
  const listeners = new Map();
  return {
    subscribe: (userId, request, response, mediaType = MovieMediaType) => Subscribe(listeners, userId, request, response, mediaType),
    publish: (userId, revision, mediaType = MovieMediaType) => Publish(listeners, userId, revision, mediaType)
  };
}

function Subscribe(listeners, userId, request, response, mediaType) {
  PrepareEventStream(response);
  const listenerKey = ListenerKey(userId, mediaType);
  const userListeners = AddListener(listeners, listenerKey, response);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), HeartbeatIntervalMs);
  request.on("close", () => RemoveListener(listeners, listenerKey, userListeners, response, heartbeat));
}

function PrepareEventStream(response) {
  response.status(200);
  response.set(EventStreamHeaders);
  response.flushHeaders?.();
  response.write(": connected\n\n");
}

function AddListener(listeners, listenerKey, response) {
  const userListeners = listeners.get(listenerKey) || new Set();
  userListeners.add(response);
  listeners.set(listenerKey, userListeners);
  return userListeners;
}

function RemoveListener(listeners, listenerKey, userListeners, response, heartbeat) {
  clearInterval(heartbeat);
  userListeners.delete(response);
  if (!userListeners.size)
    listeners.delete(listenerKey);
}

function Publish(listeners, userId, revision, mediaType) {
  const message = `event: queue\ndata: ${JSON.stringify({ revision: Number(revision) || 0, mediaType })}\n\n`;
  for (const response of listeners.get(ListenerKey(userId, mediaType)) || [])
    response.write(message);
}

function ListenerKey(userId, mediaType) {
  return `${userId}:${mediaType === TelevisionMediaType ? TelevisionMediaType : MovieMediaType}`;
}
