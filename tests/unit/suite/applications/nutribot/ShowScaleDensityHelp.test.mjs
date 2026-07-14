import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ShowScaleDensityHelp } from '#apps/nutribot/usecases/ShowScaleDensityHelp.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('ShowScaleDensityHelp', () => {
  let foodLogStore, messagingGateway, uc;
  beforeEach(() => {
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue({
        id: 'log1', status: 'pending',
        items: [{ grams: 340, toJSON() { return { grams: 340 }; } }],
      }),
    };
    messagingGateway = { updateMessage: jest.fn().mockResolvedValue(true) };
    uc = new ShowScaleDensityHelp({
      messagingGateway, foodLogStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('expands to the legend and shows a Back button when showHelp', async () => {
    await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', showHelp: true, messageId: '900' });
    const [, msgId, updates] = messagingGateway.updateMessage.mock.calls[0];
    expect(msgId).toBe('900');
    expect(updates.text).toContain('Watery');
    expect(updates.text).toContain('340 g');
    expect(updates.choices[3][1].text).toBe('⬅️ Back');
  });

  it('collapses to the slim prompt and shows Help when not showHelp', async () => {
    await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', showHelp: false, messageId: '900' });
    const [, , updates] = messagingGateway.updateMessage.mock.calls[0];
    expect(updates.text).toBe('⚖️ 340 g');
    expect(updates.choices[3][1].text).toBe('❓ Help');
  });
});
