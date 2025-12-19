/**
 * Event Router Tests
 * @group routers
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { TelegramInputAdapter } from '../../adapters/telegram/TelegramInputAdapter.mjs';
import { UnifiedEventRouter } from '../../application/routing/UnifiedEventRouter.mjs';
import { JournalistInputRouter } from '../../bots/journalist/adapters/JournalistInputRouter.mjs';

const BOT_ID = '6898194425';

// Mock container factory for NutriBot
const createMockNutribotContainer = () => {
  const mockUseCase = (name) => ({
    execute: jest.fn().mockResolvedValue({ success: true, name }),
  });

  return {
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
};

// Mock container factory for Journalist
const createMockJournalistContainer = () => {
  const mockUseCase = (name) => ({
    execute: jest.fn().mockResolvedValue({ success: true, name }),
  });

  return {
    getProcessTextEntry: jest.fn().mockReturnValue(mockUseCase('textEntry')),
    getProcessVoiceEntry: jest.fn().mockReturnValue(mockUseCase('voiceEntry')),
    getHandleCallbackResponse: jest.fn().mockReturnValue(mockUseCase('callback')),
    getHandleSlashCommand: jest.fn().mockReturnValue(mockUseCase('slashCommand')),
    getHandleSpecialStart: jest.fn().mockReturnValue(mockUseCase('specialStart')),
    getInitiateJournalPrompt: jest.fn().mockReturnValue(mockUseCase('initPrompt')),
  };
};

describe('NutriBot TelegramInputAdapter + UnifiedEventRouter', () => {
  let router;
  let mockContainer;

  beforeEach(() => {
    mockContainer = createMockNutribotContainer();
    router = new UnifiedEventRouter(mockContainer);
  });

  /**
   * Helper to parse Telegram payload and route through UnifiedEventRouter
   */
  async function parseAndRoute(telegramPayload) {
    const event = TelegramInputAdapter.parse(telegramPayload, { botId: BOT_ID });
    if (event) {
      await router.route(event);
    }
    return event;
  }

  it('should require container', () => {
    expect(() => new UnifiedEventRouter()).toThrow('container');
  });

  describe('message routing', () => {
    it('should route photo messages', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123, first_name: 'Test' },
          photo: [
            { file_id: 'small', width: 100, height: 100 },
            { file_id: 'large', width: 640, height: 480 },
          ],
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromImage).toHaveBeenCalled();
      const useCase = mockContainer.getLogFoodFromImage();
      expect(useCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          imageData: expect.objectContaining({ fileId: 'large' }),
        })
      );
    });

    it('should route UPC codes', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: '012345678901',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromUPC).toHaveBeenCalled();
    });

    it('should route text messages', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: 'ate a sandwich',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromText).toHaveBeenCalled();
    });

    it('should route voice messages', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          voice: { file_id: 'voice123', duration: 5 },
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getLogFoodFromVoice).toHaveBeenCalled();
    });
  });

  describe('command routing', () => {
    it('should route /help command', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/help',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getHandleHelpCommand).toHaveBeenCalled();
    });

    it('should route /report command', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/report',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getGenerateDailyReport).toHaveBeenCalled();
    });

    it('should route /coach command', async () => {
      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/coach',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getGenerateOnDemandCoaching).toHaveBeenCalled();
    });
  });

  describe('callback routing', () => {
    it('should route accept callback', async () => {
      const telegramPayload = {
        callback_query: {
          id: 'cb123',
          from: { id: 123 },
          message: {
            chat: { id: 123 },
            message_id: 456,
          },
          data: 'accept:log-uuid-123',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getAcceptFoodLog).toHaveBeenCalled();
    });

    it('should route discard callback', async () => {
      const telegramPayload = {
        callback_query: {
          id: 'cb123',
          from: { id: 123 },
          message: {
            chat: { id: 123 },
            message_id: 456,
          },
          data: 'discard:log-uuid-123',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getDiscardFoodLog).toHaveBeenCalled();
    });

    it('should route portion callback', async () => {
      const telegramPayload = {
        callback_query: {
          id: 'cb123',
          from: { id: 123 },
          message: {
            chat: { id: 123 },
            message_id: 456,
          },
          data: 'portion:0.5',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getSelectUPCPortion).toHaveBeenCalled();
    });
  });

  describe('revision flow', () => {
    it('should route text to revision when in revision state', async () => {
      mockContainer.getConversationStateStore.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          activeFlow: 'revision',
          flowState: { pendingLogUuid: 'log-123' },
        }),
      });

      const telegramPayload = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: 'Actually it was 2 sandwiches',
        },
      };

      await parseAndRoute(telegramPayload);

      expect(mockContainer.getProcessRevisionInput).toHaveBeenCalled();
    });
  });
});

describe('JournalistInputRouter', () => {
  let router;
  let mockContainer;

  beforeEach(() => {
    mockContainer = createMockJournalistContainer();
    router = new JournalistInputRouter(mockContainer);
  });

  it('should require container', () => {
    expect(() => new JournalistInputRouter()).toThrow('container');
  });

  describe('message routing', () => {
    it('should route text messages', async () => {
      // IInputEvent format
      const event = {
        type: 'text',
        conversationId: 'telegram:123_456',
        messageId: '456',
        payload: { text: 'Today was a good day.' },
        metadata: { firstName: 'Test', senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getProcessTextEntry).toHaveBeenCalled();
    });

    it('should route voice messages', async () => {
      const event = {
        type: 'voice',
        conversationId: 'telegram:123_456',
        messageId: '456',
        payload: { fileId: 'voice123', duration: 10 },
        metadata: { firstName: 'Test', senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getProcessVoiceEntry).toHaveBeenCalled();
    });

    it('should route slash commands', async () => {
      const event = {
        type: 'command',
        conversationId: 'telegram:123_456',
        messageId: '456',
        payload: { command: 'journal', args: null },
        metadata: { senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getHandleSlashCommand).toHaveBeenCalled();
    });

    it('should route special starts (🎲)', async () => {
      const event = {
        type: 'text',
        conversationId: 'telegram:123_456',
        messageId: '456',
        payload: { text: '🎲 Change Subject' },
        metadata: { senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getHandleSpecialStart).toHaveBeenCalled();
    });

    it('should route special starts (❌)', async () => {
      const event = {
        type: 'text',
        conversationId: 'telegram:123_456',
        messageId: '456',
        payload: { text: '❌ Cancel' },
        metadata: { senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getHandleSpecialStart).toHaveBeenCalled();
    });
  });

  describe('callback routing', () => {
    it('should route callback queries', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123_456',
        messageId: 'cb123',
        payload: { data: 'choice_0', sourceMessageId: '456' },
        metadata: { firstName: 'Test', senderId: '123' },
      };

      await router.route(event);

      expect(mockContainer.getHandleCallbackResponse).toHaveBeenCalled();
    });
  });

  it('should ignore unknown event types', async () => {
    const event = {
      type: 'unknown',
      conversationId: 'telegram:123_456',
      payload: {},
    };

    const result = await router.route(event);

    expect(result).toBeNull();
    expect(mockContainer.getProcessTextEntry).not.toHaveBeenCalled();
  });
});
