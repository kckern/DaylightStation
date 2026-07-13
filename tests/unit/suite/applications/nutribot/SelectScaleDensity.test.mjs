import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectScaleDensity } from '#apps/nutribot/usecases/SelectScaleDensity.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale' },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('SelectScaleDensity', () => {
  let messaging, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}) };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(240)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { clear: jest.fn().mockResolvedValue({}) };
    useCase = new SelectScaleDensity({
      messagingGateway: messaging, foodLogStore, conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('computes calories = grams × kcal/g[level] and shows confirm buttons', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      level: 4, messageId: '900', responseContext: messaging, // 1.4 kcal/g
    });
    expect(res.calories).toBe(336); // 240 × 1.4
    expect(savedLog.items[0].calories).toBe(336);
    expect(savedLog.items[0].label).toBe('Everyday');
    expect(stateStore.clear).toHaveBeenCalledWith('telegram:b1_c2');
    const cmds = messaging.updateMessage.mock.calls[0][1].choices.flat().map((b) => JSON.parse(b.callback_data).cmd);
    expect(cmds).toEqual(['a', 'r', 'x']);
  });
});
