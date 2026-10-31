import { useEffect, useRef } from 'react';
import { wsService } from '../../../../../../frontend/src/services/WebSocketService.js';
import { buildCommandAck, validateCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';
import { HOMELINE_TOPIC, COMMAND_HANDLER_PRESENCE_TOPIC } from '@shared-contracts/media/topics.mjs';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fitness-cast-receiver' });
  return _logger;
}

const PRESENCE_INTERVAL_MS = 10_000;

/**
 * Decide what a cast command means for the fitness kiosk. Pure, for tests.
 * The kiosk plays one item now (Media app "Play on"); queue edits, adds and
 * transport controls belong to screen-framework screens and are refused with
 * a reason so the sender fails fast instead of waiting out a timeout.
 *
 * @returns {{ play: string } | { reject: { code: string, error: string } } | null}
 *   null = not a command for this device (ignore silently).
 */
export function interpretCastCommand(msg, deviceId) {
  if (!msg || msg.type !== 'command' || !deviceId) return null;
  if (msg.targetDevice && msg.targetDevice !== deviceId) return null;
  if (!validateCommandEnvelope(msg).valid) return null;
  const { command, params = {} } = msg;
  if (command !== 'queue') {
    return { reject: { code: 'UNSUPPORTED', error: `The garage screen does not take "${command}" commands` } };
  }
  const op = params.op ?? 'play-now';
  if (op !== 'play-now') {
    return { reject: { code: 'UNSUPPORTED', error: 'The garage screen plays one item at a time' } };
  }
  const contentId = typeof params.contentId === 'string' ? params.contentId : null;
  const match = contentId && contentId.match(/^plex:(\d+)$/);
  if (!match) {
    return { reject: { code: 'UNSUPPORTED_SOURCE', error: 'The garage screen plays Plex items only' } };
  }
  return { play: match[1] };
}

/**
 * useFitnessCastReceiver — makes the fitness kiosk a Media-app cast target.
 *
 * Screen-framework screens get this from useScreenCommands +
 * CommandAckPublisher; the fitness app is not a screen-framework screen, so
 * without this the backend's homeline command reached nobody and every
 * "Play on garage" timed out. It:
 *   - announces a live command handler (command-handler-presence) so
 *     WakeAndLoad takes the WS-first path,
 *   - acks each `queue` play-now command on receipt (device-ack), and
 *   - hands the Plex id to `onPlay`, which runs the normal /fitness/play path
 *     (governance, presence gate and unlock still apply).
 * "Now playing" is confirmed by the existing DeviceStatePublisher +
 * FitnessPlayer's usePlayerSessionBinding.
 *
 * @param {object} opts
 * @param {string|null} opts.deviceId — explicit kiosk identity; inert when falsy.
 * @param {function} opts.onPlay — (plexId, { commandId }) => void
 */
export function useFitnessCastReceiver({ deviceId, onPlay } = {}) {
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

  useEffect(() => {
    if (!deviceId) return undefined;
    const seen = new Set();

    const ack = (commandId, fields) => {
      try {
        wsService.send(buildCommandAck({ deviceId, commandId, appliedAt: new Date().toISOString(), ...fields }));
      } catch (err) {
        logger().warn('fitness.cast.ack_failed', { commandId, error: String(err?.message ?? err) });
      }
    };

    const unsubscribe = wsService.subscribe(HOMELINE_TOPIC(deviceId), (msg) => {
      const decision = interpretCastCommand(msg, deviceId);
      if (!decision) return;
      const { commandId } = msg;
      if (seen.has(commandId)) return;
      seen.add(commandId);
      if (decision.reject) {
        logger().warn('fitness.cast.rejected', { commandId, command: msg.command, op: msg.params?.op ?? null, ...decision.reject });
        ack(commandId, { ok: false, ...decision.reject });
        return;
      }
      logger().info('fitness.cast.received', { commandId, plexId: decision.play, origin: msg.origin ?? null });
      ack(commandId, { ok: true });
      try {
        onPlayRef.current?.(decision.play, { commandId });
      } catch (err) {
        logger().error('fitness.cast.play_failed', { commandId, error: String(err?.message ?? err) });
      }
    });

    const presenceTopic = COMMAND_HANDLER_PRESENCE_TOPIC(deviceId);
    const sendPresence = (online) => {
      try {
        wsService.send({ topic: presenceTopic, deviceId, online, ts: new Date().toISOString() });
      } catch (err) {
        logger().warn('fitness.cast.presence_failed', { error: String(err?.message ?? err) });
      }
    };
    sendPresence(true);
    const timer = setInterval(() => sendPresence(true), PRESENCE_INTERVAL_MS);
    logger().info('fitness.cast.receiver_mounted', { deviceId });

    return () => {
      clearInterval(timer);
      sendPresence(false);
      unsubscribe?.();
      logger().info('fitness.cast.receiver_unmounted', { deviceId });
    };
  }, [deviceId]);
}

export default useFitnessCastReceiver;
