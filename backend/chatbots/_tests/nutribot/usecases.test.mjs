/**
 * NutriBot Use Cases Tests
 * @group nutribot
 * @group Phase4
 */

import { jest } from '@jest/globals';
import { GenerateDailyReport } from '../../bots/nutribot/application/usecases/GenerateDailyReport.mjs';
import { GetReportAsJSON } from '../../bots/nutribot/application/usecases/GetReportAsJSON.mjs';
import { GenerateThresholdCoaching } from '../../bots/nutribot/application/usecases/GenerateThresholdCoaching.mjs';
import { HandleHelpCommand } from '../../bots/nutribot/application/usecases/HandleHelpCommand.mjs';
import { StartAdjustmentFlow } from '../../bots/nutribot/application/usecases/StartAdjustmentFlow.mjs';

// Mock dependencies
const createMockMessagingGateway = () => ({
  sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  updateMessage: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
});

const createMockAIGateway = () => ({
  chat: jest.fn().mockResolvedValue('Here is some supportive coaching advice.'),
});

const createMockNutriLogRepo = () => ({
  findPending: jest.fn().mockResolvedValue([]),
  findByDate: jest.fn().mockResolvedValue([]),
  getDailySummary: jest.fn().mockResolvedValue({
    logCount: 2,
    itemCount: 5,
    totalGrams: 500,
    colorCounts: { green: 3, yellow: 1, orange: 1 },
    gramsByColor: { green: 300, yellow: 100, orange: 100 },
  }),
});

const createMockNutriListRepo = () => ({
  findByDate: jest.fn().mockResolvedValue([]),
});

const createMockConversationStateStore = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
});

const createMockConfig = () => ({
  getUserTimezone: jest.fn().mockReturnValue('America/New_York'),
  getThresholds: jest.fn().mockReturnValue({ daily: 2000 }),
});

describe('NutriBot Use Cases', () => {
  describe('GenerateDailyReport', () => {
    let useCase;
    let mockMessagingGateway;
    let mockNutriLogRepo;
    let mockConfig;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockNutriLogRepo = createMockNutriLogRepo();
      mockConfig = createMockConfig();

      useCase = new GenerateDailyReport({
        messagingGateway: mockMessagingGateway,
        nutriLogRepository: mockNutriLogRepo,
        nutriListRepository: createMockNutriListRepo(),
        config: mockConfig,
      });
    });

    it('should require dependencies', () => {
      expect(() => new GenerateDailyReport({})).toThrow('messagingGateway');
    });

    it('should skip if pending logs exist', async () => {
      mockNutriLogRepo.findPending.mockResolvedValue([{ id: 'log-1' }]);

      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(result.success).toBe(false);
      expect(result.skippedReason).toContain('pending');
    });

    it('should skip if no logs for date', async () => {
      mockNutriLogRepo.getDailySummary.mockResolvedValue({ logCount: 0 });

      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(result.success).toBe(false);
      expect(result.skippedReason).toContain('No food');
    });

    it('should generate report on success', async () => {
      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    });

    it('should force regenerate even with pending logs', async () => {
      mockNutriLogRepo.findPending.mockResolvedValue([{ id: 'log-1' }]);

      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
        forceRegenerate: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('GetReportAsJSON', () => {
    let useCase;
    let mockNutriLogRepo;

    beforeEach(() => {
      mockNutriLogRepo = createMockNutriLogRepo();
      mockNutriLogRepo.findByDate.mockResolvedValue([
        {
          id: 'log-1',
          isAccepted: true,
          items: [
            { id: 'item-1', label: 'Apple', grams: 150, color: 'green' },
          ],
          meal: { date: '2024-12-13', time: 'morning' },
          createdAt: '2024-12-13T10:00:00Z',
        },
      ]);

      useCase = new GetReportAsJSON({
        nutriLogRepository: mockNutriLogRepo,
        nutriListRepository: createMockNutriListRepo(),
        config: createMockConfig(),
      });
    });

    it('should return structured JSON', async () => {
      const result = await useCase.execute({
        userId: 'user-1',
      });

      expect(result.date).toBeDefined();
      expect(result.items).toBeInstanceOf(Array);
      expect(result.totals).toBeDefined();
      expect(result.pending).toBe(0);
    });

    it('should calculate totals', async () => {
      const result = await useCase.execute({
        userId: 'user-1',
      });

      expect(result.totals.grams).toBe(150);
      expect(result.totals.greenGrams).toBe(150);
    });
  });

  describe('GenerateThresholdCoaching', () => {
    let useCase;
    let mockMessagingGateway;
    let mockAIGateway;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockAIGateway = createMockAIGateway();

      useCase = new GenerateThresholdCoaching({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
        config: createMockConfig(),
      });
    });

    it('should generate coaching message', async () => {
      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
        threshold: '80%',
        dailyTotal: 1600,
        recentItems: [],
      });

      expect(result.success).toBe(true);
      expect(mockAIGateway.chat).toHaveBeenCalled();
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    });

    it('should skip if coaching already given', async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const mockStateStore = createMockConversationStateStore();
      mockStateStore.get.mockResolvedValue({
        data: { [`coaching_80%_${today}`]: true },
      });

      const useCaseWithState = new GenerateThresholdCoaching({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
        conversationStateStore: mockStateStore,
        config: createMockConfig(),
      });

      const result = await useCaseWithState.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
        threshold: '80%',
        dailyTotal: 1600,
      });

      expect(result.skipped).toBe(true);
    });
  });

  describe('HandleHelpCommand', () => {
    let useCase;
    let mockMessagingGateway;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      useCase = new HandleHelpCommand({
        messagingGateway: mockMessagingGateway,
      });
    });

    it('should send help message', async () => {
      const result = await useCase.execute({
        conversationId: 'conv-1',
      });

      expect(result.success).toBe(true);
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'conv-1',
        expect.stringContaining('/help'),
        expect.any(Object)
      );
    });
  });

  describe('StartAdjustmentFlow', () => {
    let useCase;
    let mockMessagingGateway;
    let mockStateStore;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockStateStore = createMockConversationStateStore();

      useCase = new StartAdjustmentFlow({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockStateStore,
        config: createMockConfig(),
      });
    });

    it('should set conversation state', async () => {
      await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(mockStateStore.set).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          flow: 'adjustment',
          step: 'date_selection',
        })
      );
    });

    it('should send message with date keyboard', async () => {
      const result = await useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(result.success).toBe(true);
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'conv-1',
        expect.stringContaining('Review'),
        expect.objectContaining({
          choices: expect.any(Array),
          inline: true,
        })
      );
    });
  });
});
