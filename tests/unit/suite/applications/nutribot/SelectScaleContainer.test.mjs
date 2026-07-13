import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectScaleContainer } from '#apps/nutribot/usecases/SelectScaleContainer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale', grossGrams: grams },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('SelectScaleContainer', () => {
  let messaging, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}) };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(480)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { set: jest.fn().mockResolvedValue({}) };
    useCase = new SelectScaleContainer({
      messagingGateway: messaging, foodLogStore, conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('subtracts a known container and shows the density keyboard on net grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'dinner-plate', messageId: '900', responseContext: messaging,
    });
    expect(res.net).toBe(140); // 480 − 340
    expect(savedLog.items[0].grams).toBe(140);
    const update = messaging.updateMessage.mock.calls[0][1];
    expect(update.text).toContain('140 g');
    const sd = update.choices.flat().map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    expect(stateStore.set).toHaveBeenCalledWith('telegram:b1_c2', expect.objectContaining({ activeFlow: 'scale_describe' }));
  });

  it('none keeps gross grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'none', messageId: '900', responseContext: messaging,
    });
    expect(res.net).toBe(480);
    expect(savedLog.items[0].grams).toBe(480);
  });

  it('guards against a container heavier than the reading', async () => {
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(makeLog(200));
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'mug', messageId: '900', responseContext: messaging, // mug=350 > 200
    });
    expect(res.net).toBe(200); // kept gross
  });

  it('show mode (no containerId) posts the container picker without subtracting', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: undefined, messageId: '900', responseContext: messaging,
    });
    expect(res.shown).toBe(true);
    // no subtraction / no save happened
    expect(foodLogStore.save).not.toHaveBeenCalled();
    const update = messaging.updateMessage.mock.calls[0][1];
    const containerBtns = update.choices.flat().map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'st');
    expect(containerBtns.some((d) => d.c === 'none')).toBe(true);
    expect(containerBtns.some((d) => d.c === 'dinner-plate')).toBe(true);
  });
});
