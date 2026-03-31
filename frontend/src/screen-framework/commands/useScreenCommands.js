import { useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';
import { wsService } from '../../services/WebSocketService.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenCommands' });
  return _logger;
}

const CONTENT_KEYS = ['contentId', 'play', 'queue', 'plex', 'media', 'playlist', 'files'];
const LEGACY_COLLECTION_KEYS = ['hymn', 'scripture', 'talk', 'primary', 'poem'];

/**
 * useScreenCommands - YAML-driven WebSocket command handler for screen-framework.
 *
 * Subscribes to WS messages that look like remote commands (menu, reset, playback,
 * content loading) and translates them into ActionBus events.
 *
 * Enabled by `websocket.commands: true` in the screen YAML config.
 * Guardrails (blocked topics/sources) are also YAML-driven.
 *
 * @param {object} wsConfig - The `websocket:` block from screen YAML config
 * @param {object} actionBus - ActionBus instance to emit events on
 */
export function useScreenCommands(wsConfig, actionBus, screenId) {
  const enabled = wsConfig?.commands === true;
  const guardrailsRef = useRef(wsConfig?.guardrails || {});
  guardrailsRef.current = wsConfig?.guardrails || {};
  const busRef = useRef(actionBus);
  busRef.current = actionBus;
  const screenIdRef = useRef(screenId);
  screenIdRef.current = screenId;

  const handleMessage = useCallback((data) => {
    const g = guardrailsRef.current;
    const bus = busRef.current;
    if (!bus) return;

    // Device targeting — ignore commands meant for a different device.
    // If message has targetDevice but this screen has no device configured, reject it
    // (a targeted command should only be processed by a screen that can verify it's the target).
    if (data.targetDevice) {
      if (!g.device || data.targetDevice !== g.device) {
        logger().debug('commands.ignored-target', { targetDevice: data.targetDevice, myDevice: g.device || 'none' });
        return;
      }
    }

    // Screen targeting — ignore commands meant for a different screen
    if (data.targetScreen && screenIdRef.current && data.targetScreen !== screenIdRef.current) {
      logger().debug('commands.ignored-screen', { targetScreen: data.targetScreen, myScreen: screenIdRef.current });
      return;
    }

    // Ignore playback_state broadcasts — these are status updates, not commands.
    // Without this, the broadcast loop re-triggers media:play for already-playing content.
    if (data.topic === 'playback_state') return;

    // Guardrails
    if (data.topic && g.blocked_topics?.includes(data.topic)) {
      logger().debug('commands.blocked-topic', { topic: data.topic });
      return;
    }
    if (data.source && g.blocked_sources?.includes(data.source)) {
      logger().debug('commands.blocked-source', { source: data.source });
      return;
    }
    if (data.equipmentId || data.deviceId || data.data?.vibration !== undefined) {
      logger().debug('commands.blocked-sensor');
      return;
    }

    // Menu
    if (data.menu) {
      logger().info('commands.menu', { menuId: data.menu });
      bus.emit('menu:open', { menuId: data.menu });
      return;
    }

    // Reset (dismiss overlay)
    if (data.action === 'reset') {
      logger().info('commands.reset');
      bus.emit('escape', {});
      return;
    }

    // Reload (hard page refresh — server sends no-cache on HTML)
    if (data.action === 'reload') {
      logger().info('commands.reload');
      window.location.reload();
      return;
    }

    // Sleep (display off)
    if (data.action === 'sleep') {
      logger().info('commands.sleep');
      bus.emit('display:sleep', {});
      return;
    }

    // Playback control
    if (data.playback) {
      logger().info('commands.playback', { command: data.playback });
      bus.emit('media:playback', { command: data.playback });
      return;
    }

    // Shader control
    if (data.shader) {
      logger().info('commands.shader', { shader: data.shader });
      bus.emit('display:shader', { shader: data.shader });
      return;
    }

    // Volume control
    if (data.volume != null) {
      logger().info('commands.volume', { level: data.volume });
      bus.emit('display:volume', { level: data.volume });
      return;
    }

    // Playback rate
    if (data.rate != null) {
      logger().info('commands.rate', { rate: data.rate });
      bus.emit('media:rate', { rate: data.rate });
      return;
    }

    // Barcode scan
    if (data.source === 'barcode' && data.contentId) {
      const actionMap = { queue: 'media:queue', play: 'media:play', open: 'menu:open' };
      const busAction = actionMap[data.action] || 'media:queue';
      // Pass through content options (shuffle, shader, volume, continuous)
      const { action: _a, contentId, source: _s, device: _d, topic: _t, timestamp: _ts, ...contentOptions } = data;
      logger().info('commands.barcode', { action: busAction, contentId, device: data.device, options: contentOptions });
      bus.emit(busAction, { contentId, ...contentOptions });
      if (busAction !== 'menu:open') {
        wsService.send({ type: 'content-ack', screen: screenIdRef.current, timestamp: Date.now() });
      }
      return;
    }

    // Content reference extraction
    let contentRef = null;
    for (const key of LEGACY_COLLECTION_KEYS) {
      if (data[key] != null) { contentRef = `${key}:${data[key]}`; break; }
    }
    if (!contentRef) {
      for (const key of CONTENT_KEYS) {
        const val = data[key];
        if (val != null && typeof val !== 'object') { contentRef = String(val); break; }
      }
    }

    if (contentRef) {
      const action = Object.keys(data).includes('queue') ? 'media:queue' : 'media:play';
      logger().info('commands.content', { action, contentRef });
      bus.emit(action, { contentId: contentRef });
      // Acknowledge content delivery so the backend knows WS succeeded
      wsService.send({ type: 'content-ack', screen: screenIdRef.current, timestamp: Date.now() });
      return;
    }

    logger().debug('commands.unhandled', { keys: Object.keys(data) });
  }, []);

  // Subscribe using a predicate filter - only messages that look like commands.
  // When disabled (no websocket.commands config), use a reject-all predicate
  // instead of null — null/undefined means wildcard (receive everything).
  const REJECT_ALL = () => false;
  const filter = enabled
    ? (msg) => !!(msg.menu || msg.action || msg.playback || msg.play || msg.queue
        || msg.plex || msg.contentId || msg.hymn || msg.scripture || msg.talk
        || msg.primary || msg.media || msg.playlist || msg.files || msg.poem
        || msg.source === 'barcode'
        || msg.shader || msg.volume != null || msg.rate != null)
    : REJECT_ALL;

  useWebSocketSubscription(filter, handleMessage, [handleMessage]);
}
