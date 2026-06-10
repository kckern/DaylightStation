// frontend/src/modules/Media/peek/ackRouter.js
// Correlates remote commands with device acks: one registry keyed by
// commandId, fed by a single device-ack:* subscription (PeekProvider owns
// it). Commands resolve on ack, reject on timeout — acks may arrive before
// or after the HTTP response; both orderings are fine because registration
// happens before the HTTP call.
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

export function createAckRouter({ timing = TIMING, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, nowFn = () => Date.now() } = {}) {
  const pending = new Map(); // commandId -> { resolve, reject, timer, action, deviceId, startedAt }

  return {
    register(commandId, { action = null, deviceId = null } = {}) {
      return new Promise((resolve, reject) => {
        const timer = setTimeoutFn(() => {
          pending.delete(commandId);
          reject(new Error(`ack-timeout:${commandId}`));
        }, timing.ACK_TIMEOUT_MS);
        pending.set(commandId, { resolve, reject, timer, action, deviceId, startedAt: nowFn() });
      });
    },

    /** Feed a CommandAck (§9.8). Unknown commandIds are ignored. */
    resolve({ commandId, ok, error }) {
      const entry = pending.get(commandId);
      if (!entry) return false;
      clearTimeoutFn(entry.timer);
      pending.delete(commandId);
      mediaLog.peekCommandAck({
        deviceId: entry.deviceId,
        action: entry.action,
        ok: !!ok,
        elapsedMs: nowFn() - entry.startedAt,
      });
      if (ok) entry.resolve({ ok: true });
      else entry.reject(new Error(error ?? 'ack-error'));
      return true;
    },

    pendingCount: () => pending.size,
  };
}

export default createAckRouter;
