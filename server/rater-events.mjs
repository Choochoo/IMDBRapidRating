const HeartbeatIntervalMs = 25_000;

export function CreateRaterEvents() {
  const listeners = new Map();
  return {
    subscribe(userId, request, response, mediaType = "movie") {
      response.status(200);
      response.set({
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.flushHeaders?.();
      response.write(": connected\n\n");
      const listenerKey = ListenerKey(userId, mediaType);
      const userListeners = listeners.get(listenerKey) || new Set();
      userListeners.add(response);
      listeners.set(listenerKey, userListeners);
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), HeartbeatIntervalMs);
      request.on("close", () => {
        clearInterval(heartbeat);
        userListeners.delete(response);
        if (!userListeners.size)
          listeners.delete(listenerKey);
      });
    },

    publish(userId, revision, mediaType = "movie") {
      const message = `event: queue\ndata: ${JSON.stringify({ revision: Number(revision) || 0, mediaType })}\n\n`;
      for (const response of listeners.get(ListenerKey(userId, mediaType)) || [])
        response.write(message);
    }
  };
}

function ListenerKey(userId, mediaType) {
  return `${userId}:${mediaType === "tv" ? "tv" : "movie"}`;
}
