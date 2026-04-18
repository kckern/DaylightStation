import { useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';
import { validateCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenCommands' });
  return _logger;
}

/**
 * useScreenCommands - structured-envelope WebSocket command handler.
 *
 * Consumes CommandEnvelope messages (media foundation §6.2) delivered over
 * WebSocket and dispatches them onto the ActionBus. Flat-shape legacy messages
 * (e.g. `{ playback: 'play' }`, `{ play: 'contentId' }`) are rejected — they
 * were replaced in the Phase 1 hard cutover.
 *
 * Enabled by `websocket.commands: true` in the screen YAML config.
 * Guardrails (device, blocked_topics, blocked_sources) are YAML-driven.
 *
 * @param {object} wsConfig   - The `websocket:` block from screen YAML config
 * @param {object} actionBus  - ActionBus instance to emit events on
 * @param {string} screenId   - This screen's id; used for targetScreen matching
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

    // Ignore playback_state broadcasts — status updates, not commands.
    if (data.topic === 'playback_state') return;

    // Device targeting — if the envelope names a targetDevice, it must match
    // this screen's configured device.
    if (data.targetDevice) {
      if (!g.device || data.targetDevice !== g.device) {
        logger().debug('commands.ignored-target', {
          targetDevice: data.targetDevice,
          myDevice: g.device || 'none',
        });
        return;
      }
    }

    // Screen targeting — if the envelope names a targetScreen, it must match
    // this hook's screenId.
    if (data.targetScreen && screenIdRef.current && data.targetScreen !== screenIdRef.current) {
      logger().debug('commands.ignored-screen', {
        targetScreen: data.targetScreen,
        myScreen: screenIdRef.current,
      });
      return;
    }

    // Guardrails
    if (data.topic && g.blocked_topics?.includes(data.topic)) {
      logger().debug('commands.blocked-topic', { topic: data.topic });
      return;
    }
    if (data.source && g.blocked_sources?.includes(data.source)) {
      logger().debug('commands.blocked-source', { source: data.source });
      return;
    }

    // Validate the structured envelope — reject anything that isn't a
    // well-formed CommandEnvelope (§6.2). This explicitly blocks all flat
    // legacy shapes such as `{ playback: 'play' }` or `{ play: 'plex:1' }`.
    const validation = validateCommandEnvelope(data);
    if (!validation.valid) {
      logger().debug('commands.envelope-invalid', { errors: validation.errors });
      return;
    }

    const { command, commandId, params = {} } = data;

    if (command === 'transport') {
      const { action, value } = params;
      logger().info('commands.transport', { commandId, params });
      if (action === 'seekAbs') {
        bus.emit('media:seek-abs', { value, commandId });
        return;
      }
      if (action === 'seekRel') {
        bus.emit('media:seek-rel', { value, commandId });
        return;
      }
      // play | pause | stop | skipNext | skipPrev
      bus.emit('media:playback', { command: action, commandId });
      return;
    }

    if (command === 'queue') {
      logger().info('commands.queue', { commandId, params });
      bus.emit('media:queue-op', { ...params, commandId });
      return;
    }

    if (command === 'config') {
      const { setting, value } = params;
      logger().info('commands.config', { commandId, params });
      bus.emit('media:config-set', { setting, value, commandId });
      // Back-compat: also emit the legacy UX events so existing visual
      // consumers (shader, volume display) keep working without rewiring.
      if (setting === 'shader') {
        bus.emit('display:shader', { shader: value });
      } else if (setting === 'volume') {
        bus.emit('display:volume', { level: value });
      }
      return;
    }

    if (command === 'adopt-snapshot') {
      const { snapshot, autoplay } = params;
      logger().info('commands.adopt-snapshot', { commandId, params });
      bus.emit('media:adopt-snapshot', {
        snapshot,
        autoplay: autoplay ?? true,
        commandId,
      });
      return;
    }

    if (command === 'system') {
      const { action } = params;
      logger().info('commands.system', { commandId, params });
      if (action === 'reset') {
        bus.emit('escape', {});
        return;
      }
      if (action === 'reload') {
        // Terminal — no ActionBus emit.
        window.location.reload();
        return;
      }
      if (action === 'sleep') {
        bus.emit('display:sleep', {});
        return;
      }
      if (action === 'wake') {
        // `display:wake` is not yet in the actionMap. Emit it anyway — if no
        // one is listening, ActionBus will just have no handlers. Log debug
        // so we know this path is exercised.
        logger().debug('commands.system-wake', { commandId });
        bus.emit('display:wake', {});
        return;
      }
      // Unhandled system action — validator should have caught this, but be
      // defensive.
      logger().warn('commands.system-unhandled', { action });
      return;
    }

    // Unreachable if validation is correct.
    logger().warn('commands.unhandled-kind', { command });
  }, []);

  // Subscribe with a predicate filter — only accept well-formed
  // CommandEnvelopes. When disabled, reject everything (we can't pass `null`
  // because that means wildcard = receive everything).
  const REJECT_ALL = () => false;
  const ACCEPT_ENVELOPES = (msg) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.topic === 'playback_state') return true; // swallow in handler
    if (msg.type !== 'command') return false;
    return validateCommandEnvelope(msg).valid;
  };
  const filter = enabled ? ACCEPT_ENVELOPES : REJECT_ALL;

  useWebSocketSubscription(filter, handleMessage, [handleMessage]);
}
