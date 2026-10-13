export class PianoConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  raw() { return this.configService.getHouseholdAppConfig(null, 'piano') || {}; }
  roster() { return (this.configService.getHouseholdUsers?.() || []).map(String); }
  profile(userId) { return this.configService.getUserProfile(String(userId)) || null; }
  isKnownUser(userId) { return !!this.profile(userId); }
  timezone() { return this.configService.getTimezone?.() ?? null; }
}
