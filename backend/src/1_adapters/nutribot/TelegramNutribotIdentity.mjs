/** Household/configuration projection for NutriBot's Telegram conversation identity. */
export class TelegramNutribotIdentity {
  constructor({ configService, userIdentityService } = {}) {
    if (!configService || !userIdentityService?.resolvePlatformId) {
      throw new Error('TelegramNutribotIdentity requires configService and userIdentityService');
    }
    this.configService = configService;
    this.userIdentityService = userIdentityService;
  }

  defaultUserId() {
    return this.configService.getHeadOfHousehold?.() || null;
  }

  conversationIdFor(userId) {
    const botId = this.configService.getSystemConfig('bots')?.nutribot?.telegram?.bot_id;
    const platformId = this.userIdentityService.resolvePlatformId('telegram', userId);
    return botId && platformId ? `telegram:b${botId}_c${platformId}` : null;
  }
}

export default TelegramNutribotIdentity;
