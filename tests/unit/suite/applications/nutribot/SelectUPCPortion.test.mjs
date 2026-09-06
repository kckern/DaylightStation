// tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectUPCPortion } from '#apps/nutribot/usecases/SelectUPCPortion.mjs';

describe('SelectUPCPortion', () => {
  let useCase;
  let mockMessaging;
  let mockFoodLogStore;
  let mockNutriListStore;
  let findByUuidCalledWith;
  let receipts;

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

    receipts = { refresh: jest.fn().mockResolvedValue({}) };
    useCase = new SelectUPCPortion({
      receipts: () => receipts,
      messagingGateway: mockMessaging,
      foodLogStore: mockFoodLogStore,
      nutriListStore: mockNutriListStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('userId handling', () => {
    it('uses the passed userId parameter, not extracted from conversationId', async () => {
      await useCase.execute({
        userId: 'user_1',  // This is the resolved username
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      // findByUuid should be called with 'user_1', not 'c575596036'
      expect(findByUuidCalledWith).not.toBeNull();
      expect(findByUuidCalledWith.userId).toBe('user_1');
    });

    it('passes userId (not conversationId) to nutriListStore.saveMany', async () => {
      let savedItems = null;
      mockNutriListStore.saveMany = jest.fn().mockImplementation((items) => {
        savedItems = items;
        return Promise.resolve();
      });

      await useCase.execute({
        userId: 'user_1',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      expect(savedItems).not.toBeNull();
      expect(savedItems.length).toBeGreaterThan(0);
      expect(savedItems[0].userId).toBe('user_1');
      expect(savedItems[0].chatId).toBe('telegram:b6898194425_c575596036');
    });
  });

  describe('message handling on accept', () => {
    it('updates message in-place with caption instead of deleting and resending', async () => {
      mockFoodLogStore.findByUuid = jest.fn().mockResolvedValue({
        id: 'abc123',
        userId: 'user_1',
        status: 'pending',
        items: [{ label: 'Diet Coke', grams: 355, calories: 0, unit: 'g', amount: 1 }],
        meal: { date: '2026-02-12' },
        metadata: { source: 'upc', messageId: '50' },
      });

      await useCase.execute({
        userId: 'user_1',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      expect(receipts.refresh).toHaveBeenCalledWith('user_1', 'abc123');
      expect(mockMessaging.updateMessage).not.toHaveBeenCalled();

      // Should NOT delete the message (photo should be preserved)
      expect(mockMessaging.deleteMessage).not.toHaveBeenCalled();

      // Should NOT send a new text message as replacement
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });

    it('leaves retries to the publisher without creating a replacement message', async () => {
      receipts.refresh.mockResolvedValue({ retry: true });

      mockFoodLogStore.findByUuid = jest.fn().mockResolvedValue({
        id: 'abc123',
        userId: 'user_1',
        status: 'pending',
        items: [{ label: 'Diet Coke', grams: 355, calories: 0 }],
        meal: { date: '2026-02-12' },
      });

      await useCase.execute({
        userId: 'user_1',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      expect(receipts.refresh).toHaveBeenCalled();
      expect(mockMessaging.updateMessage).not.toHaveBeenCalled();
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });
  });
});
