import { useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';
import { validateCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';
import { resolveBriefMode } from '@shared-contracts/media/playerFeatures.mjs';

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
 * @param {object} [controls] - Screen session controls (session/screenSessionControls.js):
 *   Add only rewrites remote Play into Add, remote pause/stop/replace/move
 *   leave a screen note, and every playback command stamps its origin.
 */
const SESSION_SETTINGS = new Set(['addOnly', 'endOfQueue', 'stopAfterCurrent']);
const ORIGINLESS_SETTINGS = new Set(['volume', 'shader']);

export function useScreenCommands(wsConfig, actionBus, screenId, controls = null) {
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
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
    const origin = data.origin;
    const withOrigin = (payload) => (origin ? { ...payload, origin } : payload);
    const ctl = controlsRef.current;

    // Show briefly (RQ-PLAY-11): a camera, or a clip asked to be brief, goes
    // OVER what is playing and then returns it — it is not a replace, so it
    // makes no screen note and leaves "started by" alone. Only a screen with
    // the player features attached knows how; any other screen is unchanged.
    if (command === 'queue' && params.op === 'play-now' && ctl?.extension && typeof params.contentId === 'string') {
      const isCamera = params.contentId.startsWith('camera:');
      const mode = resolveBriefMode({ brief: params.brief, briefSeconds: params.briefSeconds, origin, kind: isCamera ? 'camera' : 'clip' });
      if (isCamera || mode.brief) {
        const fromDevice = origin?.kind === 'device';
        const selfOrigin = fromDevice && !!g.device
          && String(origin.id ?? '').replace(/^fleet:/, '') === g.device;
        // Add only protects a programme from another DEVICE's start; a brief
        // is a start. Routines and the screen's own input are exempt.
        if (fromDevice && !selfOrigin && ctl.isAddOnly?.() && ctl.hasPlayback?.()) {
          logger().info('commands.brief-refused-add-only', { commandId, contentId: params.contentId, origin });
          bus.emit('command-handler-error', { commandId, code: 'ADD_ONLY', error: 'This screen is in Add only' });
          return;
        }
        if (fromDevice && !selfOrigin) {
          // A person steered this screen: say so on the screen and in "started by".
          ctl.stampOrigin?.(origin);
          ctl.markHumanInput?.();
          ctl.noteBrief?.(origin);
        }
        logger().info('commands.brief', { commandId, contentId: params.contentId, brief: mode.brief, seconds: mode.seconds, origin: origin ?? null });
        bus.emit('media:brief', withOrigin({
          kind: isCamera ? 'camera' : 'clip',
          contentId: params.contentId,
          ...(isCamera ? { cameraId: params.contentId.slice('camera:'.length) } : {}),
          ...(typeof params.title === 'string' ? { title: params.title } : {}),
          seconds: mode.seconds,
          // A camera that is NOT brief takes the screen: the programme stops.
          replace: isCamera && !mode.brief,
          commandId,
        }));
        return;
      }
    }

    // Provenance + screen notes (RQ-STEER-21). Volume/shader changes are
    // neither "who is playing this" nor note-worthy.
    const isOriginless = command === 'config' && ORIGINLESS_SETTINGS.has(params.setting);
    if (ctl && !isOriginless && command !== 'system' && command !== 'display') {
      if (origin) ctl.stampOrigin(origin);
      // Someone steered this screen: unattended auto-continue limits restart.
      if (origin?.kind === 'device') ctl.markHumanInput?.();
    }

    // The screen's own origin (its fleet id) is local input, not "another
    // device": no Add-only rewrite and no screen note.
    const ownId = g.device;
    const isSelfOrigin = origin?.kind === 'device' && !!ownId
      && String(origin.id ?? '').replace(/^fleet:/, '') === ownId;
    // Add only (RQ-PLAY-10): another DEVICE's Play adds instead of replacing,
    // and the ack says so (appliedAs). Routine and originless starts (HA
    // buttons, triggers, schedules) are exempt — they always play (B5).
    // Nothing loaded → nothing to protect.
    let effectiveParams = params;
    if (ctl?.isAddOnly?.() && command === 'queue' && origin?.kind === 'device' && !isSelfOrigin && ctl.hasPlayback?.()) {
      if (params.op === 'play-now') {
        effectiveParams = { op: 'add', contentId: params.contentId, appliedAs: 'add', requestedOp: 'play-now' };
      } else if (params.op === 'item-action' && (params.kind === 'playNow' || params.kind === 'shuffle')) {
        const { clearRest: _clearRest, ...rest } = params;
        effectiveParams = { ...rest, kind: 'add', appliedAs: 'add', requestedKind: params.kind };
      }
      if (effectiveParams !== params) {
        logger().info('commands.add-only-applied', { commandId, requestedOp: params.op, requestedKind: params.kind ?? null, contentId: params.contentId ?? params.item?.contentId ?? null, origin: origin ?? null });
      }
    }
    if (ctl && effectiveParams === params && !isSelfOrigin) {
      ctl.noteRemoteCommand?.({ command, params, origin, commandId });
    }

    if (command === 'transport') {
      const { action, value } = params;
      logger().info('commands.transport', { commandId, params });
      if (action === 'seekAbs') {
        bus.emit('media:seek-abs', withOrigin({ value, commandId }));
        return;
      }
      if (action === 'goLive') {
        bus.emit('media:go-live', withOrigin({ commandId }));
        return;
      }
      if (action === 'seekRel') {
        bus.emit('media:seek-rel', withOrigin({ value, commandId }));
        return;
      }
      // play | pause | stop | skipNext | skipPrev
      bus.emit('media:playback', withOrigin({
        command: action, commandId,
        // The sender's explicit answer to "Keep the music?" on a Stop.
        ...(action === 'stop' && typeof params.keepMusic === 'boolean' ? { keepMusic: params.keepMusic } : {}),
      }));
      return;
    }

    if (command === 'queue') {
      logger().info('commands.queue', { commandId, params: effectiveParams });
      bus.emit('media:queue-op', withOrigin({ ...effectiveParams, commandId }));
      return;
    }

    if (command === 'display') {
      logger().info('commands.display', { commandId, params });
      bus.emit('display:content', { id: params.contentId, commandId });
      return;
    }

    if (command === 'session') {
      const { action, ...rest } = params;
      logger().info('commands.session', { commandId, action, origin: origin ?? null });
      bus.emit('media:session-control', withOrigin({ kind: 'session', action, params: rest, commandId }));
      return;
    }

    if (command === 'config' && SESSION_SETTINGS.has(params.setting)) {
      logger().info('commands.session-config', { commandId, setting: params.setting, value: params.value });
      bus.emit('media:session-control', withOrigin({ kind: 'config', setting: params.setting, value: params.value, commandId }));
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
      }
      // Volume is applied by the playback owner via media:config-set (ScreenActionHandler); no legacy display event.
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

    if (command === 'handoff') {
      // The receiving owner/executor is intentionally not installed in F3a.
      // Forward the complete validated envelope so its explicit terminal
      // unsupported result can be correlated without an optimistic receipt.
      logger().info('commands.handoff', { commandId, transferId: params.transferId, op: params.op });
      bus.emit('media:handoff', { ...params, commandId });
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
