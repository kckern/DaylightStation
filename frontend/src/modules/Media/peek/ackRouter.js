// frontend/src/modules/Media/peek/ackRouter.js
// Correlates remote commands with device acks: one registry keyed by
// commandId, fed by a single device-ack:* subscription (PeekProvider owns
// it). Commands resolve on ack, reject on timeout — acks may arrive before
// or after the HTTP response; both orderings are fine because registration
// happens before the HTTP call.
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';
import { validateHandoffCommandAck } from '@shared-contracts/media/handoff.mjs';

export function createAckRouter({ timing = TIMING, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, nowFn = () => Date.now() } = {}) {
  const pending = new Map(); // commandId -> { resolve, reject, timer, action, deviceId, startedAt }

  return {
    register(commandId, { action = null, deviceId = null, handoffCommand = null } = {}) {
      if (pending.has(commandId)) return Promise.reject(new Error(`ack-duplicate:${commandId}`));
      return new Promise((resolve, reject) => {
        const timer = setTimeoutFn(() => {
          pending.delete(commandId);
          reject(new Error(`ack-timeout:${commandId}`));
        }, timing.ACK_TIMEOUT_MS);
        pending.set(commandId, { resolve, reject, timer, action, deviceId, handoffCommand, startedAt: nowFn() });
      });
    },

    /** Feed a CommandAck (§9.8). Unknown commandIds are ignored. */
    resolve(ack) {
      const { commandId, ok, error } = ack ?? {};
      const entry = pending.get(commandId);
      if (!entry) return false;
      if (entry.handoffCommand && ack?.deviceId !== entry.deviceId) return false;
      if (entry.handoffCommand && !validateHandoffCommandAck(entry.handoffCommand, ack, { target: { kind: 'device', id: entry.deviceId } }).valid) return false;
      clearTimeoutFn(entry.timer);
      pending.delete(commandId);
      mediaLog.peekCommandAck({
        deviceId: entry.deviceId,
        action: entry.action,
        ok: !!ok,
        elapsedMs: nowFn() - entry.startedAt,
      });
      if (entry.handoffCommand) entry.resolve({ ...ack });
      else if (ok) entry.resolve({ ok: true });
      else entry.reject(new Error(error ?? 'ack-error'));
      return true;
    },

    pendingCount: () => pending.size,
  };
}

export default createAckRouter;
