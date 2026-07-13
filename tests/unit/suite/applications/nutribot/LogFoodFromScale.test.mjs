// tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromScale } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('LogFoodFromScale', () => {
  let messaging, foodLogStore, stateStore, useCase, saved;

  beforeEach(() => {
    saved = [];
    messaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '900' }),
      updateMessage: jest.fn().mockResolvedValue({}),
    };
    foodLogStore = { save: jest.fn().mockImplementation((log) => { saved.push(log); return Promise.resolve(); }) };
    stateStore = { set: jest.fn().mockResolvedValue({}) };
    useCase = new LogFoodFromScale({
      messagingGateway: messaging,
      foodLogStore,
      conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}),
      config: { getUserTimezone: () => 'America/Los_Angeles' },
      logger,
    });
  });

  it('creates a pending entry and posts the density keyboard for a light reading', async () => {
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', grams: 90, unit: 'g', scaleId: 'kitchen' });
    expect(res.stage).toBe('density');
    expect(foodLogStore.save).toHaveBeenCalled();
    const text = messaging.sendMessage.mock.calls[0][1];
    expect(text).toContain('90 g');
    // density keyboard present (9 density levels + a container affordance)
    const sd = messaging.sendMessage.mock.calls[0][2].choices.flat()
      .map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    // scale_describe state set at density stage
    expect(stateStore.set).toHaveBeenCalledWith('telegram:b1_c2', expect.objectContaining({ activeFlow: 'scale_describe' }));
  });

  it('posts the container keyboard for a heavy reading (above threshold)', async () => {
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', grams: 480, unit: 'g', scaleId: 'kitchen' });
    expect(res.stage).toBe('container');
    const choices = messaging.sendMessage.mock.calls[0][2].choices;
    expect(JSON.parse(choices[0][0].callback_data)).toMatchObject({ cmd: 'st', c: 'none' });
    // container stage does NOT arm scale_describe yet
    expect(stateStore.set).not.toHaveBeenCalled();
  });
});
