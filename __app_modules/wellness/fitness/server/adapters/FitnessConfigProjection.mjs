import { resolveSupervisorIds } from '../../shared/supervision.mjs';

export class FitnessConfigProjection {
  #warned = false;
  constructor({ configService, logger = console }) { this.configService = configService; this.logger = logger; }
  resolveHouseholdId(hid) { return hid || this.configService.getDefaultHouseholdId(); }
  raw(hid) {
    const householdId = this.resolveHouseholdId(hid);
    const config = this.configService.getHouseholdAppConfig(householdId, 'fitness') || null;
    if (!config) return null;
    const governance = config.governance || {};
    if (Array.isArray(governance.superusers) && governance.superusers.length && !this.#warned) {
      this.#warned = true;
      this.logger.warn?.('governance.config.superusers_retired', { householdId, ignored: governance.superusers.length });
    }
    const superusers = resolveSupervisorIds(
      this.configService.getAllUserProfiles?.() ?? new Map(), householdId, this.configService.getDefaultHouseholdId(),
    );
    return { ...config, governance: { ...governance, superusers } };
  }
  publicConfig(hid) { return this.raw(hid); }
  missingConfigHint(hid) {
    const householdId = this.resolveHouseholdId(hid);
    return `household[-${householdId}]/fitness/config.yml (or legacy household[-${householdId}]/config/fitness.yml)`;
  }
}
