/**
 * TelegramInputAdapter + UnifiedEventRouter ConversationId Format Tests
 * 
 * Tests that the Telegram parsing and routing pipeline correctly builds
 * conversationId in the format "telegram:{botId}_{chatId}"
 * 
 * This test validates the unified pattern used by production:
 * TelegramInputAdapter.parse() → InputEvent → UnifiedEventRouter.route()
 */

import { jest } from '@jest/globals';
import { TelegramInputAdapter } from '../../../adapters/telegram/TelegramInputAdapter.mjs';
import { UnifiedEventRouter } from '../../../application/routing/UnifiedEventRouter.mjs';

const BOT_ID = '6898194425';
const USER_ID = '575596036';

describe('TelegramInputAdapter + UnifiedEventRouter - ConversationId Format', () => {
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

    router = new UnifiedEventRouter(mockContainer);
  });

  /**
   * Helper to parse and route a Telegram payload
   */
  async function parseAndRoute(telegramPayload) {
    const event = TelegramInputAdapter.parse(telegramPayload, { botId: BOT_ID });
    if (event) {
      await router.route(event);
    }
    return event;
  }

  describe('conversationId format for text messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 100,
          from: { id: parseInt(USER_ID), is_bot: false, first_name: 'Kirk' },
          chat: { id: parseInt(USER_ID), type: 'private' },
          date: 1702656000,
          text: 'ate a sandwich',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromText).toHaveBeenCalled();
      expect(capturedParams.logText).toBeDefined();
      expect(capturedParams.logText.conversationId).toBe(`telegram:${BOT_ID}_${USER_ID}`);
    });
  });

  describe('conversationId format for photo messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 101,
          from: { id: parseInt(USER_ID), is_bot: false, first_name: 'Kirk' },
          chat: { id: parseInt(USER_ID), type: 'private' },
          date: 1702656000,
          photo: [
            { file_id: 'small_123', width: 90, height: 90 },
            { file_id: 'large_456', width: 640, height: 480 },
          ],
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromImage).toHaveBeenCalled();
      expect(capturedParams.logImage).toBeDefined();
      expect(capturedParams.logImage.conversationId).toBe(`telegram:${BOT_ID}_${USER_ID}`);
    });
  });

  describe('conversationId format for UPC messages', () => {
    it('should build conversationId as "telegram:{botId}_{chatId}"', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 102,
          from: { id: parseInt(USER_ID) },
          chat: { id: parseInt(USER_ID), type: 'private' },
          date: 1702656000,
          text: '012345678901',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromUPC).toHaveBeenCalled();
      expect(capturedParams.logUPC).toBeDefined();
      expect(capturedParams.logUPC.conversationId).toBe(`telegram:${BOT_ID}_${USER_ID}`);
    });
  });

  describe('conversationId format for callback queries', () => {
    it('should build conversationId for accept callback', async () => {
      const telegramPayload = {
        update_id: 123456789,
        callback_query: {
          id: 'query123',
          from: { id: parseInt(USER_ID) },
          message: {
            message_id: 103,
            chat: { id: parseInt(USER_ID), type: 'private' },
          },
          data: 'accept:log-uuid-123',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getAcceptFoodLog).toHaveBeenCalled();
      expect(capturedParams.accept).toBeDefined();
      expect(capturedParams.accept.conversationId).toBe(`telegram:${BOT_ID}_${USER_ID}`);
    });
  });

  describe('TelegramInputAdapter.buildConversationId', () => {
    it('should build correct format', () => {
      const result = TelegramInputAdapter.buildConversationId('123456', '789');
      expect(result).toBe('telegram:123456_789');
    });

    it('should parse conversationId correctly', () => {
      const parsed = TelegramInputAdapter.parseConversationId('telegram:6898194425_575596036');
      expect(parsed).toEqual({ botId: '6898194425', userId: '575596036' });
    });
  });
});
