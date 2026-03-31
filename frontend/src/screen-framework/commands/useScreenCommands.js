import { useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

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
export function useScreenCommands(wsConfig, actionBus) {
  const enabled = wsConfig?.commands === true;
  const guardrailsRef = useRef(wsConfig?.guardrails || {});
  guardrailsRef.current = wsConfig?.guardrails || {};
  const busRef = useRef(actionBus);
  busRef.current = actionBus;

  const handleMessage = useCallback((data) => {
    const g = guardrailsRef.current;
    const bus = busRef.current;
    if (!bus) return;

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

    // Playback control
    if (data.playback) {
      logger().info('commands.playback', { command: data.playback });
      bus.emit('media:playback', { command: data.playback });
      return;
    }

    // Barcode scan
    if (data.source === 'barcode' && data.contentId) {
      const actionMap = { queue: 'media:queue', play: 'media:play', open: 'menu:open' };
      const busAction = actionMap[data.action] || 'media:queue';
      logger().info('commands.barcode', { action: busAction, contentId: data.contentId, device: data.device });
      bus.emit(busAction, { contentId: data.contentId });
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
      return;
    }

    logger().debug('commands.unhandled', { keys: Object.keys(data) });
  }, []);

  // Subscribe using a predicate filter - only messages that look like commands
  const filter = enabled
    ? (msg) => !!(msg.menu || msg.action || msg.playback || msg.play || msg.queue
        || msg.plex || msg.contentId || msg.hymn || msg.scripture || msg.talk
        || msg.primary || msg.media || msg.playlist || msg.files || msg.poem
        || msg.source === 'barcode')
    : null;

  useWebSocketSubscription(filter, handleMessage, [handleMessage]);
}
