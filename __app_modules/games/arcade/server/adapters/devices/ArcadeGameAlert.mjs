import { IArcadeGameSupervisorAlert } from "../../application/ports/IArcadeGameSupervisorAlert.mjs";

/**
 * Sends a supervisor alert to a phone through NotificationService (the
 * Android app, else Home Assistant at the device's own `notify_service` — the
 * channel the rest of the house uses to reach a parent about that screen).
 *
 * Best effort by design: a failed alert is logged and swallowed. It must never
 * become an exception on the observation path, because the meter continuing to
 * measure matters more than the message arriving.
 */
export class ArcadeGameAlert extends IArcadeGameSupervisorAlert {
  #sendPush; #serviceByDevice; #logger;

  constructor({ sendPush = null, serviceByDevice = new Map(), logger = console }) {
    super();
    this.#sendPush = typeof sendPush === 'function' ? sendPush : null;
    this.#serviceByDevice = serviceByDevice;
    this.#logger = logger;
  }

  async raise({ deviceId, condition, message }) {
    const service = this.#serviceByDevice.get(deviceId);
    if (!this.#sendPush || !service) {
      this.#logger.warn?.('arcade.alert.undeliverable', {
        deviceId, condition,
        note: 'no notify service configured for this device — the alert has nowhere to go',
      });
      return false;
    }
    try {
      const results = await this.#sendPush({ title: 'Arcade', message, haNotifyService: service });
      const delivered = (results || []).some(r => r.delivered === true || r.accepted === true);
      this.#logger.info?.('arcade.alert.sent', { deviceId, condition, delivered });
      return delivered;
    } catch (error) {
      this.#logger.warn?.('arcade.alert.failed', { deviceId, condition, error: error.message });
      return false;
    }
  }
}

export default ArcadeGameAlert;
