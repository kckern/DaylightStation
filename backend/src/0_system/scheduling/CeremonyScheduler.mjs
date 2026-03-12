const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit',
  cycle_retro: 'cycle',
  phase_review: 'phase',
  season_alignment: 'season',
  era_vision: 'era',
};

export class CeremonyScheduler {
  #ceremonyService;
  #notificationService;
  #lifePlanStore;
  #ceremonyRecordStore;
  #cadenceService;
  #clock;

  constructor({ ceremonyService, notificationService, lifePlanStore, ceremonyRecordStore, cadenceService, clock }) {
    this.#ceremonyService = ceremonyService;
    this.#notificationService = notificationService;
    this.#lifePlanStore = lifePlanStore;
    this.#ceremonyRecordStore = ceremonyRecordStore;
    this.#cadenceService = cadenceService;
    this.#clock = clock;
  }

  async checkAndNotify(username) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return;

    const ceremonies = plan.ceremonies || {};
    const cadencePosition = this.#cadenceService.resolve(
      plan.cadence || {},
      this.#clock?.now?.() || new Date()
    );

    for (const [type, cadenceLevel] of Object.entries(CEREMONY_CADENCE_MAP)) {
      const config = ceremonies[type];
      if (!config?.enabled) continue;

      const periodId = cadencePosition?.[cadenceLevel]?.periodId;
      if (!periodId) continue;

      // Check if due
      const isDue = this.#cadenceService.isCeremonyDue(type, cadencePosition);
      if (!isDue) continue;

      // Check if already completed for this period
      const alreadyDone = this.#ceremonyRecordStore.hasRecord(username, type, periodId);
      if (alreadyDone) continue;

      // Send notification
      this.#notificationService.send({
        type: 'ceremony_due',
        ceremony: type,
        periodId,
        username,
        title: `Time for ${type.replace(/_/g, ' ')}`,
        channel: config.channel || 'push',
      });
    }
  }
}
