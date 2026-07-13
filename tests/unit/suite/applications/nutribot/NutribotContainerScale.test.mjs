import { describe, it, expect } from '@jest/globals';
import { NutribotContainer } from '#apps/nutribot/NutribotContainer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('NutribotContainer scale use cases', () => {
  const container = new NutribotContainer(
    { getUserTimezone: () => 'America/Los_Angeles' },
    {
      messagingGateway: { sendMessage: async () => ({ messageId: '1' }), updateMessage: async () => ({}) },
      aiGateway: { chat: async () => '{}' },
      foodLogStore: { save: async () => {}, findByUuid: async () => null },
      conversationStateStore: { set: async () => {}, get: async () => null, clear: async () => {} },
      scaleConfig: normalizeScaleNutribotConfig({}),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }
  );

  it('exposes the four scale use cases', () => {
    expect(container.getLogFoodFromScale()).toBeTruthy();
    expect(container.getSelectScaleContainer()).toBeTruthy();
    expect(container.getSelectScaleDensity()).toBeTruthy();
    expect(container.getLogScaleFoodFromText()).toBeTruthy();
  });
});
