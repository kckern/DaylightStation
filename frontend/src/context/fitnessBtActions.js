// Pure builders for the Bluetooth controller-management bus messages the
// frontend publishes. Kept pure + separate so they're unit-testable without
// React or the WebSocket service.
export function buildPairRequest({ requestId, durationMs = 30000 }) {
  return { topic: 'bt.pair.request', requestId, durationMs };
}
export function buildRemoveRequest({ requestId, address }) {
  return { topic: 'bt.remove', requestId, address };
}
