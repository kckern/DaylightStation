// tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectUPCPortion } from '#apps/nutribot/usecases/SelectUPCPortion.mjs';

describe('SelectUPCPortion', () => {
  let useCase;
  let mockMessaging;
  let mockFoodLogStore;
  let mockNutriListStore;
  let findByUuidCalledWith;

  beforeEach(() => {
    findByUuidCalledWith = null;

    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    };

    mockFoodLogStore = {
      findByUuid: jest.fn().mockImplementation((uuid, userId) => {
        findByUuidCalledWith = { uuid, userId };
        return Promise.resolve({
          id: uuid,
          userId,
          status: 'pending',
          items: [{ label: 'Test Food', grams: 100, calories: 200 }],
          meal: { date: '2026-01-30' },
        });
      }),
      updateStatus: jest.fn().mockResolvedValue({}),
      findPending: jest.fn().mockResolvedValue([]),
    };

    mockNutriListStore = {
      saveMany: jest.fn().mockResolvedValue({}),
    };

    useCase = new SelectUPCPortion({
      messagingGateway: mockMessaging,
      foodLogStore: mockFoodLogStore,
      nutriListStore: mockNutriListStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('userId handling', () => {
    it('uses the passed userId parameter, not extracted from conversationId', async () => {
      await useCase.execute({
        userId: 'kckern',  // This is the resolved username
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      // findByUuid should be called with 'kckern', not 'c575596036'
      expect(findByUuidCalledWith).not.toBeNull();
      expect(findByUuidCalledWith.userId).toBe('kckern');
    });
  });
});
