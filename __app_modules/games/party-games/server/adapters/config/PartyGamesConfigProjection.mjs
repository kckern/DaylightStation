export class PartyGamesConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  raw() { return this.configService.getHouseholdAppConfig(null, 'party-games') || null; }
}
