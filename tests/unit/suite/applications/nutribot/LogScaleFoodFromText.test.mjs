import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogScaleFoodFromText } from '#apps/nutribot/usecases/LogScaleFoodFromText.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale', messageId: '900' },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('LogScaleFoodFromText', () => {
  let messaging, aiGateway, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}), deleteMessage: jest.fn().mockResolvedValue({}) };
    aiGateway = { chat: jest.fn().mockResolvedValue('{"label":"Lasagna","density_kcal_per_g":1.7,"protein_per_g":0.08,"carbs_per_g":0.14,"fat_per_g":0.08}') };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(350)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { clear: jest.fn().mockResolvedValue({}) };
    useCase = new LogScaleFoodFromText({ messagingGateway: messaging, aiGateway, foodLogStore, conversationStateStore: stateStore, logger });
  });

  it('estimates blended density and multiplies by the exact grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      text: 'leftover lasagna', messageId: '555', responseContext: messaging,
    });
    expect(res.calories).toBe(595); // 350 × 1.7
    expect(savedLog.items[0].label).toBe('Lasagna');
    expect(savedLog.items[0].calories).toBe(595);
    // the prompt tells the AI the grams are exact
    const userMsg = aiGateway.chat.mock.calls[0][0].map((m) => m.content).join(' ');
    expect(userMsg).toContain('350');
    expect(stateStore.clear).toHaveBeenCalled();
    // confirmation must land on the BOT's prompt message, not the user's inbound message
    expect(messaging.updateMessage).toHaveBeenCalledWith('900', expect.objectContaining({ text: expect.any(String) }));
    expect(messaging.deleteMessage).toHaveBeenCalledWith('555');
  });
});
