export class ReleaseEmergencyLockdown {
  #repo; #publications; #logger;
  constructor({ repo, publications, logger } = {}) {
    if (!repo || !publications?.released) throw new Error('ReleaseEmergencyLockdown: repo, publications required');
    this.#repo = repo; this.#publications = publications; this.#logger = logger || console;
  }
  async execute({ by, now } = {}) {
    await this.#repo.clear();
    this.#publications.released({ by, at: now });
    this.#logger.info?.('emergency.released', { by });
  }
}
