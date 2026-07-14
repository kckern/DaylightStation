import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ExpireScaleLog } from '#apps/nutribot/usecases/ExpireScaleLog.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const scaleLog = (over = {}) => ({
  id: 'log1', status: 'pending',
  items: [{ grams: 480 }],
  metadata: { source: 'scale', containerId: null, densityLevel: null, ...over },
});

describe('ExpireScaleLog', () => {
  let foodLogStore, messagingGateway, stateStore, uc;
  beforeEach(() => {
    foodLogStore = { findByUuid: jest.fn().mockResolvedValue(scaleLog()), updateStatus: jest.fn().mockResolvedValue({}) };
    messagingGateway = { deleteMessage: jest.fn().mockResolvedValue({}) };
    stateStore = { get: jest.fn().mockResolvedValue({ flowState: { pendingLogUuid: 'log1' } }), clear: jest.fn().mockResolvedValue({}) };
    uc = new ExpireScaleLog({ messagingGateway, foodLogStore, conversationStateStore: stateStore, logger });
  });

  it('expires an untouched pending scale log: rejects + deletes + clears its describe state', async () => {
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, expired: true });
    expect(foodLogStore.updateStatus).toHaveBeenCalledWith('kckern', 'log1', 'rejected');
    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith('c', '900');
    expect(stateStore.clear).toHaveBeenCalledWith('c');
  });

  it('does nothing when the log was already touched (density chosen)', async () => {
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(scaleLog({ densityLevel: 5 }));
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, expired: false });
    expect(foodLogStore.updateStatus).not.toHaveBeenCalled();
    expect(messagingGateway.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not clear describe state that points at a different log', async () => {
    stateStore.get = jest.fn().mockResolvedValue({ flowState: { pendingLogUuid: 'other' } });
    await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', messageId: '900' });
    expect(stateStore.clear).not.toHaveBeenCalled();
  });
});
