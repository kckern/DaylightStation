export class EconomyConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  policy() { return this.configService.getHouseholdAppConfig?.(null, 'economy') || {}; }
  hasUser(userId) { return !!this.configService.getUserProfile?.(userId); }
}
