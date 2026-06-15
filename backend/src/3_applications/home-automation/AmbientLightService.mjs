/**
 * AmbientLightService — subscribes to Home Assistant illuminance sensors over the
 * HA websocket and rebroadcasts max(lux) on the eventbus so the frontend (ArtMode)
 * can auto-dim to the room. Reconnects with backoff; seeds an initial value via REST.
 */
import WebSocket from 'ws';
import { AmbientLightTracker } from '../../2_domains/home-automation/AmbientLightTracker.mjs';

export function createAmbientLightService({
  haGateway, eventBus, config, logger = console,
  WebSocketImpl = WebSocket, now = () => Date.now(),
}) {
  const entities = config?.entities ?? [];
  const topic = config?.topic ?? 'ambient';
  const tracker = new AmbientLightTracker({ threshold: 1 });
  const THROTTLE_MS = 2000;
  let lastBroadcast = 0;
  let ws = null;
  let backoff = 1000;
  let stopped = false;

  function publish(lux, force = false) {
    const t = now();
    if (!force && t - lastBroadcast < THROTTLE_MS) return;
    lastBroadcast = t;
    eventBus.broadcast(topic, { topic, lux, sources: tracker.sources() });
  }

  // Handle one HA websocket frame. `send` serializes+sends a reply object.
  function _onHaMessage(raw, send) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'auth_required') {
      const { token } = haGateway.getConnection?.() ?? {};
      send({ type: 'auth', access_token: token });
      return;
    }
    if (msg.type === 'auth_ok') {
      send({ id: 1, type: 'subscribe_events', event_type: 'state_changed' });
      return;
    }
    if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data?.entity_id;
      if (!entities.includes(entity)) return;
      const isFirstReading = !(entity in tracker.sources());
      const r = tracker.update(entity, msg.event.data?.new_state?.state);
      if (r.changed) publish(r.lux, isFirstReading);
    }
  }

  async function seed() {
    try {
      const states = await haGateway.getStates(entities);
      for (const [entity, s] of states) tracker.update(entity, s.state);
      const m = tracker.max();
      if (m !== null) publish(m, true);
    } catch (err) {
      logger.warn?.('ambient.seed.failed', { error: err.message });
    }
  }

  function connect() {
    if (stopped) return;
    const conn = haGateway.getConnection?.();
    if (!conn?.baseUrl) { logger.warn?.('ambient.no_connection'); return; }
    const url = conn.baseUrl.replace(/^http/i, 'ws') + '/api/websocket';
    ws = new WebSocketImpl(url);
    ws.on('open', () => { backoff = 1000; logger.info?.('ambient.ws.open'); });
    ws.on('message', (data) => _onHaMessage(data.toString(), (m) => ws.send(JSON.stringify(m))));
    const retry = () => {
      if (stopped) return;
      logger.warn?.('ambient.ws.reconnect', { inMs: backoff });
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    ws.on('close', retry);
    ws.on('error', (err) => { logger.warn?.('ambient.ws.error', { error: err.message }); });
  }

  async function start() {
    if (!entities.length) { logger.info?.('ambient.disabled', { reason: 'no entities' }); return; }
    await seed();
    connect();
  }

  function stop() {
    stopped = true;
    try { ws?.close(); } catch { /* ignore */ }
  }

  return { start, stop, _onHaMessage };
}

export default createAmbientLightService;
