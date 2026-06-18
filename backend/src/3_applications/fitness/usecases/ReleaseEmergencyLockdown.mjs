export class ReleaseEmergencyLockdown {
  #repo; #eventBus; #logger;
  constructor({ repo, eventBus, logger } = {}) {
    if (!repo || !eventBus) throw new Error('ReleaseEmergencyLockdown: repo, eventBus required');
    this.#repo = repo; this.#eventBus = eventBus; this.#logger = logger || console;
  }
  async execute({ by, now } = {}) {
    await this.#repo.clear();
    this.#eventBus.broadcast('fitness.emergency.released', { by, at: now });
    this.#logger.info?.('emergency.released', { by });
  }
}
