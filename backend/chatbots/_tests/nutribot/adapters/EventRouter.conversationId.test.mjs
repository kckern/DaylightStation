/**
 * EventRouter ConversationId Format Tests
 * 
 * Tests that the EventRouter correctly builds conversationId
 * in the format "telegram:{botId}_{chatId}"
 */

import { jest } from '@jest/globals';
import { NutribotEventRouter } from '../../../nutribot/adapters/EventRouter.mjs';

describe('NutribotEventRouter - ConversationId Format', () => {
  let router;
  let mockContainer;
  let capturedParams;

  beforeEach(() => {
    capturedParams = {};
    
    const mockUseCase = (name) => ({
      execute: jest.fn().mockImplementation((params) => {
        capturedParams[name] = params;
        return Promise.resolve({ success: true });
      }),
    });

    mockContainer = {
      getConfig: jest.fn().mockReturnValue({
        telegram: { botId: '6898194425' }
      }),
      getLogFoodFromImage: jest.fn().mockReturnValue(mockUseCase('logImage')),
      getLogFoodFromText: jest.fn().mockReturnValue(mockUseCase('logText')),
      getLogFoodFromVoice: jest.fn().mockReturnValue(mockUseCase('logVoice')),
      getLogFoodFromUPC: jest.fn().mockReturnValue(mockUseCase('logUPC')),
      getAcceptFoodLog: jest.fn().mockReturnValue(mockUseCase('accept')),
      getDiscardFoodLog: jest.fn().mockReturnValue(mockUseCase('discard')),
      getReviseFoodLog: jest.fn().mockReturnValue(mockUseCase('revise')),
      getProcessRevisionInput: jest.fn().mockReturnValue(mockUseCase('revisionInput')),
      getSelectUPCPortion: jest.fn().mockReturnValue(mockUseCase('selectPortion')),
      getSelectDateForAdjustment: jest.fn().mockReturnValue(mockUseCase('selectDate')),
      getSelectItemForAdjustment: jest.fn().mockReturnValue(mockUseCase('selectItem')),
      getApplyPortionAdjustment: jest.fn().mockReturnValue(mockUseCase('applyPortion')),
      getDeleteListItem: jest.fn().mockReturnValue(mockUseCase('deleteItem')),
      getHandleHelpCommand: jest.fn().mockReturnValue(mockUseCase('help')),
      getGenerateDailyReport: jest.fn().mockReturnValue(mockUseCase('report')),
      getStartAdjustmentFlow: jest.fn().mockReturnValue(mockUseCase('startAdjust')),
      getGenerateOnDemandCoaching: jest.fn().mockReturnValue(mockUseCase('coach')),
      getConfirmAllPending: jest.fn().mockReturnValue(mockUseCase('confirmAll')),
      getConversationStateStore: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(null),
      }),
    };

    router = new NutribotEventRouter(mockContainer);
  });

  describe('conversationId format for text messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 100,
          from: { id: 575596036, is_bot: false, first_name: 'Kirk' },
          chat: { id: 575596036, type: 'private' },
          date: 1702656000,
          text: 'ate a sandwich',
        },
      };

      await router.route(telegramPayload);

      expect(mockContainer.getLogFoodFromText).toHaveBeenCalled();
      expect(capturedParams.logText).toBeDefined();
      expect(capturedParams.logText.conversationId).toBe('telegram:6898194425_575596036');
      expect(capturedParams.logText.userId).toBe('575596036');
    });
  });

  describe('conversationId format for photo messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 101,
          from: { id: 575596036, is_bot: false, first_name: 'Kirk' },
          chat: { id: 575596036, type: 'private' },
          date: 1702656000,
          photo: [
            { file_id: 'small_123', width: 90 },
            { file_id: 'large_456', width: 640 },
          ],
        },
      };

      await router.route(telegramPayload);

      expect(mockContainer.getLogFoodFromImage).toHaveBeenCalled();
      expect(capturedParams.logImage).toBeDefined();
      expect(capturedParams.logImage.conversationId).toBe('telegram:6898194425_575596036');
    });
  });

  describe('conversationId format for UPC messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 102,
          from: { id: 575596036 },
          chat: { id: 575596036, type: 'private' },
          date: 1702656000,
          text: '012345678901',
        },
      };

      await router.route(telegramPayload);

      expect(mockContainer.getLogFoodFromUPC).toHaveBeenCalled();
      expect(capturedParams.logUPC).toBeDefined();
      expect(capturedParams.logUPC.conversationId).toBe('telegram:6898194425_575596036');
    });
  });

  describe('conversationId format for callback queries', () => {
    it('should build conversationId for accept callback', async () => {
      const telegramPayload = {
        update_id: 123456789,
        callback_query: {
          id: 'query123',
          from: { id: 575596036 },
          message: {
            message_id: 103,
            chat: { id: 575596036, type: 'private' },
          },
          data: 'accept:log-uuid-123',
        },
      };

      await router.route(telegramPayload);

      expect(mockContainer.getAcceptFoodLog).toHaveBeenCalled();
      expect(capturedParams.accept).toBeDefined();
      expect(capturedParams.accept.conversationId).toBe('telegram:6898194425_575596036');
    });
  });

  describe('fallback botId', () => {
    it('should use fallback botId if config not available', async () => {
      // Create router with no getConfig method
      const containerWithoutConfig = {
        ...mockContainer,
        getConfig: undefined,
      };
      
      const routerWithFallback = new NutribotEventRouter(containerWithoutConfig);

      const telegramPayload = {
        message: {
          message_id: 104,
          from: { id: 575596036 },
          chat: { id: 575596036 },
          text: 'test',
        },
      };

      await routerWithFallback.route(telegramPayload);

      // Should use the hardcoded fallback botId
      expect(capturedParams.logText.conversationId).toMatch(/^telegram:\d+_575596036$/);
    });
  });
});
