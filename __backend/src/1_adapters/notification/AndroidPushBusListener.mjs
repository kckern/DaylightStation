/**
 * Feeds the phone registry from the WebSocket bus: the Android app sends
 * `{type:'push.hello', username, deviceId}` on connect and every 30 s; a closed
 * connection is forgotten.
 */
export function attachAndroidPushBusListener({ eventBus, registry, clock, logger } = {}) {
  const known = new Set();
  let live = true;
  eventBus.onClientMessage((connectionId, message) => {
    if (!live || message?.type !== 'push.hello') return;
    const username = typeof message.username === 'string' ? message.username : '';
    const deviceId = typeof message.deviceId === 'string' ? message.deviceId : '';
    if (!username || !deviceId) return;
    registry.recordHello({ username, deviceId, connectionId, atMs: clock.now().getTime() });
    if (!known.has(connectionId)) {
      known.add(connectionId);
      logger?.info?.('notification.android.connected', { username, deviceId, connectionId });
    } else {
      logger?.debug?.('notification.android.hello', { username, connectionId });
    }
  });
  eventBus.onClientDisconnection((connectionId) => {
    if (!live) return;
    if (known.delete(connectionId)) logger?.info?.('notification.android.disconnected', { connectionId });
    registry.forget(connectionId);
  });
  return () => { live = false; };
}
