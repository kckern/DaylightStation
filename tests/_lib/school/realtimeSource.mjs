/** In-memory WebSocket boundary for mounted School projection tests. */
export function createSchoolRealtimeSource() {
  let connected = true;
  const listeners = new Set(); const statusListeners = new Set();
  return {
    subscribe(topics, callback) {
      const item = { topics: typeof topics === 'string' ? [topics] : topics, callback };
      listeners.add(item); return () => listeners.delete(item);
    },
    getStatus: () => ({ connected }),
    onStatusChange(callback) { statusListeners.add(callback); callback({ connected }); return () => statusListeners.delete(callback); },
    emit(message) { for (const item of listeners) if (item.topics.includes(message.topic)) item.callback(message); },
    status(value) { connected = value; statusListeners.forEach(callback => callback({ connected })); },
    reset() { listeners.clear(); statusListeners.clear(); connected = true; },
  };
}
