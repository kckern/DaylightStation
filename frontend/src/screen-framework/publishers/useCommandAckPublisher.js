import { useEffect, useRef } from 'react';
import { wsService } from '../../services/WebSocketService.js';
import { buildCommandAck } from '@shared-contracts/media/envelopes.mjs';
import { COMMAND_HANDLER_PRESENCE_TOPIC } from '@shared-contracts/media/topics.mjs';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'CommandAckPublisher' });
  return _logger;
}

/**
 * Events emitted by `useScreenCommands` that carry a `commandId` correlator.
 * We listen for these on the ActionBus and ack them as "received by handler".
 */
const ACKED_COMMAND_EVENTS = Object.freeze([
  'media:playback',
  'media:seek-abs',
  'media:seek-rel',
  'media:queue-op',
  'media:config-set',
  'media:adopt-snapshot',
  'escape',
  'display:sleep',
  'display:wake',
]);

const ERROR_EVENT = 'command-handler-error';

const DEDUPE_TTL_MS = 60_000;
const PRESENCE_INTERVAL_MS = 10_000;

/**
 * useCommandAckPublisher - emits CommandAck (§6.3) for every dispatched
 * command envelope reaching the ActionBus.
 *
 * v1 contract: an ack is sent the moment a command-dispatch event with a
 * `commandId` is emitted on the ActionBus (i.e. "the command reached a
 * handler"). Downstream handlers do not yet report their own success/failure;
 * handlers that explicitly fail can emit `command-handler-error` with
 * `{ commandId, error, code? }` to produce an `ok: false` ack.
 *
 * Each commandId is acked at most once within a 60s rolling window to keep
 * the channel quiet if the same event is re-emitted on the bus.
 *
 * Future work (out of scope): handlers emit explicit acks after actually
 * applying state changes, replacing this dispatch-time optimism.
 *
 * @param {object} opts
 * @param {string} opts.deviceId   - Required; hook is a no-op when falsy.
 * @param {object} opts.actionBus  - ActionBus with `.subscribe(action, handler)`.
 */
export function useCommandAckPublisher({ deviceId, actionBus } = {}) {
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const busRef = useRef(actionBus);
  busRef.current = actionBus;

  useEffect(() => {
    if (!deviceId) return undefined;
    const bus = busRef.current;
    if (!bus || typeof bus.subscribe !== 'function') return undefined;

    // commandId -> timestamp of last ack. Used for the 60s dedupe window.
    const recent = new Map();

    const isStillRecent = (ts) => (Date.now() - ts) < DEDUPE_TTL_MS;

    const pruneExpired = () => {
      for (const [cid, ts] of recent) {
        if (!isStillRecent(ts)) recent.delete(cid);
      }
    };

    const publishAck = ({ commandId, ok, error, code }) => {
      if (typeof commandId !== 'string' || commandId.length === 0) {
        logger().debug('ack-skipped-no-commandId', { ok });
        return;
      }
      pruneExpired();
      if (recent.has(commandId)) {
        logger().debug('ack-deduped', { commandId });
        return;
      }
      recent.set(commandId, Date.now());

      try {
        const ack = buildCommandAck({
          deviceId: deviceIdRef.current,
          commandId,
          ok,
          error,
          code,
          appliedAt: new Date().toISOString(),
        });
        wsService.send(ack);
        logger().debug('ack-sent', { commandId, ok });
      } catch (err) {
        logger().warn('ack-build-failed', { commandId, error: String(err?.message ?? err) });
      }
    };

    const successHandler = (payload) => {
      const commandId = payload?.commandId;
      if (!commandId) return;
      publishAck({ commandId, ok: true });
    };

    const errorHandler = (payload) => {
      const commandId = payload?.commandId;
      if (!commandId) return;
      publishAck({
        commandId,
        ok: false,
        error: payload?.error != null ? String(payload.error) : undefined,
        code: payload?.code,
      });
    };

    const unsubs = [];
    for (const evt of ACKED_COMMAND_EVENTS) {
      unsubs.push(bus.subscribe(evt, successHandler));
    }
    unsubs.push(bus.subscribe(ERROR_EVENT, errorHandler));

    const presenceTopic = COMMAND_HANDLER_PRESENCE_TOPIC(deviceId);
    const sendPresence = (online) => {
      try {
        wsService.send({
          topic: presenceTopic,
          deviceId,
          online,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        logger().warn('presence-send-failed', { error: String(err?.message ?? err) });
      }
    };

    sendPresence(true);
    const presenceTimer = setInterval(() => sendPresence(true), PRESENCE_INTERVAL_MS);

    logger().info('mounted', { deviceId });

    return () => {
      clearInterval(presenceTimer);
      sendPresence(false);
      for (const u of unsubs) {
        try { u?.(); } catch (err) {
          logger().warn('unsubscribe-failed', { error: String(err?.message ?? err) });
        }
      }
      recent.clear();
      logger().info('unmounted', { deviceId });
    };
  }, [deviceId]);
}

export default useCommandAckPublisher;
