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

    it('passes userId (not conversationId) to nutriListStore.saveMany', async () => {
      let savedItems = null;
      mockNutriListStore.saveMany = jest.fn().mockImplementation((items) => {
        savedItems = items;
        return Promise.resolve();
      });

      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      expect(savedItems).not.toBeNull();
      expect(savedItems.length).toBeGreaterThan(0);
      expect(savedItems[0].userId).toBe('kckern');
      expect(savedItems[0].chatId).toBe('telegram:b6898194425_c575596036');
    });
  });

  describe('message handling on accept', () => {
    it('updates message in-place with caption instead of deleting and resending', async () => {
      mockFoodLogStore.findByUuid = jest.fn().mockResolvedValue({
        id: 'abc123',
        userId: 'kckern',
        status: 'pending',
        items: [{ label: 'Diet Coke', grams: 355, calories: 0, unit: 'g', amount: 1 }],
        meal: { date: '2026-02-12' },
        metadata: { source: 'upc', messageId: '50' },
      });

      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      // Should update message caption in-place (not delete)
      expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
        'telegram:b6898194425_c575596036',
        '50',
        expect.objectContaining({
          caption: expect.any(String),
          choices: [],
        })
      );

      // Should NOT delete the message (photo should be preserved)
      expect(mockMessaging.deleteMessage).not.toHaveBeenCalled();

      // Should NOT send a new text message as replacement
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });

    it('falls back to sendMessage when updateMessage fails', async () => {
      mockMessaging.updateMessage = jest.fn().mockRejectedValue(new Error('Telegram API error'));

      mockFoodLogStore.findByUuid = jest.fn().mockResolvedValue({
        id: 'abc123',
        userId: 'kckern',
        status: 'pending',
        items: [{ label: 'Diet Coke', grams: 355, calories: 0 }],
        meal: { date: '2026-02-12' },
      });

      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      expect(mockMessaging.updateMessage).toHaveBeenCalled();
      expect(mockMessaging.sendMessage).toHaveBeenCalled();
    });
  });
});
