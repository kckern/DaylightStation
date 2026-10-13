import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

export class NotificationGovernanceConfigSource {
  constructor({ configService }) { this.configService = configService; }
  read() {
    const config = this.configService?.reloadHouseholdAppConfig?.(null, 'notifications') || {};
    return {
      quietHours: new QuietHours(config.quiet_hours || { enabled: false }),
      cooldowns: config.cooldowns || { default: 60 },
    };
  }
}
