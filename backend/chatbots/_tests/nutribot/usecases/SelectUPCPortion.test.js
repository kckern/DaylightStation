import { jest } from '@jest/globals';
import { SelectUPCPortion } from '../../../bots/nutribot/application/usecases/SelectUPCPortion.mjs';

const createMessagingGateway = () => ({
  updateMessage: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
});

const createNutriLogRepo = (log) => ({
  findByUuid: jest.fn().mockResolvedValue(log),
  updateStatus: jest.fn().mockResolvedValue(undefined),
  findPending: jest.fn().mockResolvedValue([]),
});

const createNutriListRepo = () => ({
  saveMany: jest.fn().mockResolvedValue(undefined),
});

describe('SelectUPCPortion', () => {
  const conversationId = 'telegram:uid_123';
  const logUuid = 'log-123';

  it('cleans up buttons when log already processed', async () => {
    const messagingGateway = createMessagingGateway();
    const nutriLog = {
      status: 'accepted',
      items: [{ label: 'Item', grams: 10, calories: 20 }],
    };
    const nutriLogRepository = createNutriLogRepo(nutriLog);
    const useCase = new SelectUPCPortion({
      messagingGateway,
      nutrilogRepository: nutriLogRepository,
      nutrilistRepository: createNutriListRepo(),
      generateDailyReport: null,
    });

    const result = await useCase.execute({
      conversationId,
      logUuid,
      portionFactor: 0.25,
      messageId: 'msg-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already processed');
    expect(messagingGateway.updateMessage).toHaveBeenCalledWith(conversationId, 'msg-1', { choices: [] });
    expect(messagingGateway.deleteMessage).not.toHaveBeenCalled();
    expect(nutriLogRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('deletes message if clearing buttons fails', async () => {
    const messagingGateway = createMessagingGateway();
    messagingGateway.updateMessage.mockRejectedValue(new Error('fail')); // force fallback

    const nutriLogRepository = createNutriLogRepo({ status: 'accepted', items: [{}] });
    const useCase = new SelectUPCPortion({
      messagingGateway,
      nutrilogRepository: nutriLogRepository,
      nutrilistRepository: createNutriListRepo(),
      generateDailyReport: null,
    });

    await useCase.execute({
      conversationId,
      logUuid,
      portionFactor: 0.25,
      messageId: 'msg-2',
    });

    expect(messagingGateway.updateMessage).toHaveBeenCalled();
    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith(conversationId, 'msg-2');
  });

  it('accepts pending log, scales items, and deletes prompt', async () => {
    const messagingGateway = createMessagingGateway();
    const nutriLog = {
      status: 'pending',
      meal: { date: '2025-12-29' },
      items: [{ label: 'Chia', grams: 100, calories: 500, protein: 10, carbs: 20, fat: 30 }],
    };
    const nutriLogRepository = createNutriLogRepo(nutriLog);
    const nutriListRepository = createNutriListRepo();
    const generateDailyReport = { execute: jest.fn().mockResolvedValue({ success: true }) };

    const useCase = new SelectUPCPortion({
      messagingGateway,
      nutrilogRepository: nutriLogRepository,
      nutrilistRepository: nutriListRepository,
      generateDailyReport,
    });

    const result = await useCase.execute({
      conversationId,
      logUuid,
      portionFactor: 0.5,
      messageId: 'msg-3',
    });

    expect(result.success).toBe(true);
    expect(result.portionFactor).toBe(0.5);
    expect(result.item.grams).toBe(50);
    expect(nutriLogRepository.findByUuid).toHaveBeenCalledWith(logUuid, '123');
    expect(nutriLogRepository.updateStatus).toHaveBeenCalledWith(logUuid, 'accepted', '123');
    expect(nutriListRepository.saveMany).toHaveBeenCalledTimes(1);
    const saved = nutriListRepository.saveMany.mock.calls[0][0][0];
    expect(saved.grams).toBe(50);
    expect(saved.calories).toBe(250);
    expect(saved.chatId).toBe(conversationId);
    expect(saved.logUuid).toBe(logUuid);
    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith(conversationId, 'msg-3');
  });
});
