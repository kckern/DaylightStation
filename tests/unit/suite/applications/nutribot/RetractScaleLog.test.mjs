import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetractScaleLog } from '#apps/nutribot/usecases/RetractScaleLog.mjs';

describe('RetractScaleLog', () => {
  let messagingGateway, foodLogStore, stateStore, logger, uc;
  beforeEach(() => {
    messagingGateway = { deleteMessage: jest.fn().mockResolvedValue(true) };
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue({ status: 'pending', metadata: { source: 'scale' } }),
      updateStatus: jest.fn().mockResolvedValue(true),
    };
    stateStore = {
      get: jest.fn().mockResolvedValue({ flowState: { pendingLogUuid: 'log1' } }),
      clear: jest.fn().mockResolvedValue(true),
    };
    logger = { debug() {}, info() {}, warn() {} };
    uc = new RetractScaleLog({ messagingGateway, foodLogStore, conversationStateStore: stateStore, logger });
  });

  it('rejects + deletes an untouched pending scale log', async () => {
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c1', logUuid: 'log1', messageId: '55' });
    expect(res).toMatchObject({ success: true, retracted: true });
    expect(foodLogStore.updateStatus).toHaveBeenCalledWith('kckern', 'log1', 'rejected');
    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith('c1', '55');
    expect(stateStore.clear).toHaveBeenCalledWith('c1');
  });

  it('leaves a touched (density-picked) log alone', async () => {
    foodLogStore.findByUuid.mockResolvedValue({ status: 'pending', metadata: { source: 'scale', densityLevel: 4 } });
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c1', logUuid: 'log1', messageId: '55' });
    expect(res).toMatchObject({ retracted: false });
    expect(foodLogStore.updateStatus).not.toHaveBeenCalled();
    expect(messagingGateway.deleteMessage).not.toHaveBeenCalled();
  });
});
