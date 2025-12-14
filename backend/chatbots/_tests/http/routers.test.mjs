/**
 * Event Router Tests
 * @group routers
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { NutribotEventRouter } from '../../nutribot/adapters/EventRouter.mjs';
import { JournalistEventRouter } from '../../journalist/adapters/EventRouter.mjs';

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

describe('NutribotEventRouter', () => {
  let router;
  let mockContainer;

  beforeEach(() => {
    mockContainer = createMockNutribotContainer();
    router = new NutribotEventRouter(mockContainer);
  });

  it('should require container', () => {
    expect(() => new NutribotEventRouter()).toThrow('container');
  });

  describe('message routing', () => {
    it('should route photo messages', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123, first_name: 'Test' },
          photo: [
            { file_id: 'small', width: 100 },
            { file_id: 'large', width: 640 },
          ],
        },
      };

      await router.route(event);

      expect(mockContainer.getLogFoodFromImage).toHaveBeenCalled();
      const useCase = mockContainer.getLogFoodFromImage();
      expect(useCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '123',
          imageData: { fileId: 'large' },
        })
      );
    });

    it('should route UPC codes', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: '012345678901',
        },
      };

      await router.route(event);

      expect(mockContainer.getLogFoodFromUPC).toHaveBeenCalled();
    });

    it('should route text messages', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: 'ate a sandwich',
        },
      };

      await router.route(event);

      expect(mockContainer.getLogFoodFromText).toHaveBeenCalled();
    });

    it('should route voice messages', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          voice: { file_id: 'voice123', duration: 5 },
        },
      };

      await router.route(event);

      expect(mockContainer.getLogFoodFromVoice).toHaveBeenCalled();
    });
  });

  describe('command routing', () => {
    it('should route /help command', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/help',
        },
      };

      await router.route(event);

      expect(mockContainer.getHandleHelpCommand).toHaveBeenCalled();
    });

    it('should route /report command', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/report',
        },
      };

      await router.route(event);

      expect(mockContainer.getGenerateDailyReport).toHaveBeenCalled();
    });

    it('should route /coach command', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          text: '/coach',
        },
      };

      await router.route(event);

      expect(mockContainer.getGenerateOnDemandCoaching).toHaveBeenCalled();
    });
  });

  describe('callback routing', () => {
    it('should route accept callback', async () => {
      const event = {
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

      await router.route(event);

      expect(mockContainer.getAcceptFoodLog).toHaveBeenCalled();
    });

    it('should route discard callback', async () => {
      const event = {
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

      await router.route(event);

      expect(mockContainer.getDiscardFoodLog).toHaveBeenCalled();
    });

    it('should route portion callback', async () => {
      const event = {
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

      await router.route(event);

      expect(mockContainer.getSelectUPCPortion).toHaveBeenCalled();
    });
  });

  describe('revision flow', () => {
    it('should route text to revision when in revision state', async () => {
      mockContainer.getConversationStateStore.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          flow: 'revision',
          pendingLogUuid: 'log-123',
        }),
      });

      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: 'Actually it was 2 sandwiches',
        },
      };

      await router.route(event);

      expect(mockContainer.getProcessRevisionInput).toHaveBeenCalled();
    });
  });
});

describe('JournalistEventRouter', () => {
  let router;
  let mockContainer;

  beforeEach(() => {
    mockContainer = createMockJournalistContainer();
    router = new JournalistEventRouter(mockContainer);
  });

  it('should require container', () => {
    expect(() => new JournalistEventRouter()).toThrow('container');
  });

  describe('message routing', () => {
    it('should route text messages', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123, first_name: 'Test' },
          text: 'Today was a good day.',
        },
      };

      await router.route(event);

      expect(mockContainer.getProcessTextEntry).toHaveBeenCalled();
    });

    it('should route voice messages', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123, first_name: 'Test' },
          voice: { file_id: 'voice123', duration: 10 },
        },
      };

      await router.route(event);

      expect(mockContainer.getProcessVoiceEntry).toHaveBeenCalled();
    });

    it('should route slash commands', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: '/journal',
        },
      };

      await router.route(event);

      expect(mockContainer.getHandleSlashCommand).toHaveBeenCalled();
    });

    it('should route special starts (🎲)', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: '🎲 Change Subject',
        },
      };

      await router.route(event);

      expect(mockContainer.getHandleSpecialStart).toHaveBeenCalled();
    });

    it('should route special starts (❌)', async () => {
      const event = {
        message: {
          chat: { id: 123 },
          message_id: 456,
          from: { id: 123 },
          text: '❌ Cancel',
        },
      };

      await router.route(event);

      expect(mockContainer.getHandleSpecialStart).toHaveBeenCalled();
    });
  });

  describe('callback routing', () => {
    it('should route callback queries', async () => {
      const event = {
        callback_query: {
          id: 'cb123',
          from: { id: 123, first_name: 'Test' },
          message: {
            chat: { id: 123 },
            message_id: 456,
          },
          data: 'choice_0',
        },
      };

      await router.route(event);

      expect(mockContainer.getHandleCallbackResponse).toHaveBeenCalled();
    });
  });

  it('should ignore edited messages', async () => {
    const event = {
      edited_message: {
        chat: { id: 123 },
        message_id: 456,
        text: 'Edited text',
      },
    };

    await router.route(event);

    expect(mockContainer.getProcessTextEntry).not.toHaveBeenCalled();
  });
});
