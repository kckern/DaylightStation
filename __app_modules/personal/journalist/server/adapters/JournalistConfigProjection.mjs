export class JournalistConfigProjection {
  constructor({ configService }) {
    if (!configService) throw new Error('JournalistConfigProjection requires configService');
    this.configService = configService;
  }
  read() {
    return {
      username: this.configService.getHeadOfHousehold?.() || 'user_1',
      dataDir: this.configService.getDataDir?.() || './data',
      getUserTimezone: (userId) => this.configService.getHouseholdTimezone?.(
        this.configService.getUserHouseholdId?.(userId),
      ) || 'America/Los_Angeles',
    };
  }
}
