export class FitnessConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  resolveHouseholdId(hid) { return hid || this.configService.getDefaultHouseholdId(); }
  raw(hid) { return this.configService.getHouseholdAppConfig(this.resolveHouseholdId(hid), 'fitness') || null; }
  publicConfig(hid) { return this.raw(hid); }
  missingConfigHint(hid) {
    const householdId = this.resolveHouseholdId(hid);
    return `household[-${householdId}]/fitness/config.yml (or legacy household[-${householdId}]/config/fitness.yml)`;
  }
}
