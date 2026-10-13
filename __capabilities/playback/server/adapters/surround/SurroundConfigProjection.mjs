export class SurroundConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  read() {
    return { enforceOrder: this.configService?.getHouseholdAppConfig?.(null, 'surround')?.enforceOrder !== false };
  }
}
