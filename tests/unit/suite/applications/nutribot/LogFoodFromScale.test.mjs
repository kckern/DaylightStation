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

    // Assert initial log item shape and metadata
    expect(saved[0].toJSON().items[0]).toMatchObject({
      label: 'Unknown',
      grams: 90,
      calories: 0,
      amount: 1,
      color: 'yellow',
    });
    expect(saved[0].toJSON().metadata).toMatchObject({
      source: 'scale',
    });

    // Assert messageId is persisted after send (saved twice: initial create, then with messageId)
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(saved[saved.length - 1].toJSON().metadata.messageId).toBe('900');
  });

  it('posts the density keyboard for a heavy reading (density-first, container is a button)', async () => {
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', grams: 480, unit: 'g', scaleId: 'kitchen' });
    expect(res.stage).toBe('density');
    const text = messaging.sendMessage.mock.calls[0][1];
    expect(text).toBe('⚖️ 480 g');
    const choices = messaging.sendMessage.mock.calls[0][2].choices;
    const sd = choices.flat().map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    const st = choices.flat().map((b) => JSON.parse(b.callback_data)).find((d) => d.cmd === 'st');
    expect(st).toMatchObject({ cmd: 'st' });
    expect(st.c).toBeUndefined();
    expect(stateStore.set).toHaveBeenCalledWith('telegram:b1_c2', expect.objectContaining({ activeFlow: 'scale_describe' }));
  });

  it('create path returns the sent messageId and is density-first', async () => {
    messaging.sendMessage = jest.fn().mockResolvedValue({ messageId: 555 });
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'c', grams: 340, unit: 'g', scaleId: 'kitchen' });
    expect(res).toMatchObject({ success: true, stage: 'density', messageId: '555' });
    expect(messaging.sendMessage).toHaveBeenCalledWith('c', '⚖️ 340 g', expect.objectContaining({ inline: true }));
  });

  it('edit mode updates an untouched pending scale log in place (no new send)', async () => {
    const existing = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 210, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 210, containerId: null, densityLevel: null, messageId: '900' },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(existing);
    messaging.sendMessage = jest.fn();
    messaging.updateMessage = jest.fn().mockResolvedValue(true);
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'c', grams: 340, unit: 'g', scaleId: 'kitchen', existingLogUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, logUuid: 'log1', edited: true });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(messaging.updateMessage).toHaveBeenCalledWith('c', '900', expect.objectContaining({ text: '⚖️ 340 g', inline: true }));
  });

  it('edit mode no-ops (posts nothing) when the log was already touched', async () => {
    const touched = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 210, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 210, containerId: null, densityLevel: 5, messageId: '900' },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(touched);
    messaging.sendMessage = jest.fn();
    messaging.updateMessage = jest.fn();
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'c', grams: 340, existingLogUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, edited: false, touched: true });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(messaging.updateMessage).not.toHaveBeenCalled();
  });
});
