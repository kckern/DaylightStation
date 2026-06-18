import { LockdownState } from '#domains/fitness/value-objects/LockdownState.mjs';

export class TriggerEmergencyLockdown {
  #repo; #haGateway; #eventBus; #scriptId; #defaultDurationSec; #logger;
  constructor({ repo, haGateway, eventBus, scriptId, defaultDurationSec = 1800, logger } = {}) {
    if (!repo || !haGateway || !eventBus) throw new Error('TriggerEmergencyLockdown: repo, haGateway, eventBus required');
    this.#repo = repo; this.#haGateway = haGateway; this.#eventBus = eventBus;
    this.#scriptId = scriptId; this.#defaultDurationSec = defaultDurationSec; this.#logger = logger || console;
  }
  async execute({ lockedBy, durationSec, now }) {
    const state = LockdownState.create({ lockedBy, durationSec: durationSec ?? this.#defaultDurationSec, now });
    await this.#repo.save(state);
    const entity = this.#scriptId.startsWith('script.') ? this.#scriptId : `script.${this.#scriptId}`;
    await this.#haGateway.callService('script', 'turn_on', { entity_id: entity });
    this.#logger.info?.('emergency.ha_fired', { entity });
    this.#eventBus.broadcast('fitness.emergency.locked', { lockedUntil: state.lockedUntil, lockedBy: state.lockedBy, lockedAt: state.lockedAt });
    this.#logger.info?.('emergency.locked', { lockedBy, until: state.lockedUntil });
    return state;
  }
}
