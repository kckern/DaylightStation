// tests/unit/suite/applications/nutribot/LogFoodFromUPC.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromUPC } from '#apps/nutribot/usecases/LogFoodFromUPC.mjs';

describe('LogFoodFromUPC', () => {
  let useCase;
  let mockMessaging;
  let mockUpcGateway;
  let mockFoodLogStore;
  let savedLog;

  beforeEach(() => {
    savedLog = null;
    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: '101' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    };
    mockUpcGateway = {
      lookup: jest.fn().mockResolvedValue({
        name: 'Test Product',
        brand: 'TestBrand',
        serving: { size: 100, unit: 'g' },
        nutrition: { calories: 200, protein: 10, carbs: 20, fat: 5 },
      }),
    };
    mockFoodLogStore = {
      save: jest.fn().mockImplementation((log) => {
        savedLog = log;
        return Promise.resolve();
      }),
    };

    useCase = new LogFoodFromUPC({
      messagingGateway: mockMessaging,
      upcGateway: mockUpcGateway,
      foodLogStore: mockFoodLogStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('userId handling', () => {
    it('uses the passed userId parameter, not extracted from conversationId', async () => {
      await useCase.execute({
        userId: 'kckern',  // This is the resolved username
        conversationId: 'telegram:b6898194425_c575596036',
        upc: '012345678901',
        messageId: '50',
      });

      // The saved log should have userId='kckern', not 'c575596036'
      expect(savedLog).not.toBeNull();
      expect(savedLog.userId).toBe('kckern');
    });
  });
});
