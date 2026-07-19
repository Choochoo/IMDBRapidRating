const HeartbeatIntervalMs = 25_000;

export function CreateRaterEvents() {
  const listeners = new Map();
  return {
    subscribe(userId, request, response) {
      response.status(200);
      response.set({
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.flushHeaders?.();
      response.write(": connected\n\n");
      const userListeners = listeners.get(userId) || new Set();
      userListeners.add(response);
      listeners.set(userId, userListeners);
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), HeartbeatIntervalMs);
      request.on("close", () => {
        clearInterval(heartbeat);
        userListeners.delete(response);
        if (!userListeners.size)
          listeners.delete(userId);
      });
    },

    publish(userId, revision) {
      const message = `event: queue\ndata: ${JSON.stringify({ revision: Number(revision) || 0 })}\n\n`;
      for (const response of listeners.get(userId) || [])
        response.write(message);
    }
  };
}
