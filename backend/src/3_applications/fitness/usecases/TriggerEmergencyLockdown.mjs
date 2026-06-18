import { LockdownState } from '#domains/fitness/value-objects/LockdownState.mjs';

const delay = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export class TriggerEmergencyLockdown {
  #repo; #haGateway; #eventBus; #scriptId; #defaultDurationSec; #shutdownBufferMs; #logger;
  constructor({ repo, haGateway, eventBus, scriptId, defaultDurationSec = 1800, shutdownBufferMs = 5000, logger } = {}) {
    if (!repo || !haGateway || !eventBus) throw new Error('TriggerEmergencyLockdown: repo, haGateway, eventBus required');
    this.#repo = repo; this.#haGateway = haGateway; this.#eventBus = eventBus;
    this.#scriptId = scriptId; this.#defaultDurationSec = defaultDurationSec;
    this.#shutdownBufferMs = shutdownBufferMs; this.#logger = logger || console;
  }
  async execute({ lockedBy, durationSec, now }) {
    const state = LockdownState.create({ lockedBy, durationSec: durationSec ?? this.#defaultDurationSec, now });
    const entity = this.#scriptId.startsWith('script.') ? this.#scriptId : `script.${this.#scriptId}`;

    // Lock the SCREEN first, fire HA after a short buffer: the kiosk shows
    // "LOCKED" while the equipment keeps running for a beat, so the cutover isn't
    // jarringly instant. Persist + broadcast first → every screen flips to LOCKED
    // (the initiating screen via WS and the commit() response both observe it).
    await this.#repo.save(state);
    this.#eventBus.broadcast('fitness.emergency.locked', { lockedUntil: state.lockedUntil, lockedBy: state.lockedBy, lockedAt: state.lockedAt });
    this.#logger.info?.('emergency.locked', { lockedBy, until: state.lockedUntil, bufferMs: this.#shutdownBufferMs });

    await delay(this.#shutdownBufferMs);

    try {
      await this.#haGateway.callService('script', 'turn_on', { entity_id: entity });
      this.#logger.info?.('emergency.ha_fired', { entity });
    } catch (err) {
      // The shutdown never reached the garage — don't strand the user behind a
      // LOCKED screen while the equipment runs on. Compensate: release the lock
      // (clear + broadcast released → screens return to normal) and surface the
      // failure to the caller (500).
      this.#logger.warn?.('emergency.ha_failed_releasing', { entity, message: err?.message ?? null });
      try { await this.#repo.clear(); } catch { /* best-effort */ }
      this.#eventBus.broadcast('fitness.emergency.released', { by: 'ha-shutdown-failed', at: now });
      throw err;
    }
    return state;
  }
}
