// tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';

describe('LogFoodFromImage', () => {
  let useCase;
  let mockMessaging;
  let mockAI;
  let mockFoodLogStore;
  let mockConversationStateStore;

  beforeEach(() => {
    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: '200' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
      getFileUrl: jest.fn(),
    };

    mockAI = {
      chatWithImage: jest.fn().mockResolvedValue(JSON.stringify({
        items: [{
          name: 'Chicken Breast',
          icon: 'chicken',
          noom_color: 'green',
          quantity: 1,
          unit: 'piece',
          grams: 150,
          calories: 230,
          protein: 43,
          carbs: 0,
          fat: 5,
          fiber: 0,
          sugar: 0,
          sodium: 70,
          cholesterol: 100,
        }],
      })),
    };

    mockFoodLogStore = {
      save: jest.fn().mockResolvedValue({}),
    };

    mockConversationStateStore = {
      get: jest.fn().mockResolvedValue(null),
      clear: jest.fn().mockResolvedValue({}),
    };

    useCase = new LogFoodFromImage({
      messagingGateway: mockMessaging,
      aiGateway: mockAI,
      foodLogStore: mockFoodLogStore,
      conversationStateStore: mockConversationStateStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('photo-first status', () => {
    it('sends photo with analyzing caption as the status message', async () => {
      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
        responseContext: mockMessaging,
      });

      // Should send photo with status caption (not a text message)
      expect(mockMessaging.sendPhoto).toHaveBeenCalledWith(
        expect.anything(), // photo source (URL or buffer)
        expect.stringContaining('Analyzing'),
        expect.any(Object)
      );
    });

    it('updates photo caption in-place on success instead of delete+resend', async () => {
      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
        responseContext: mockMessaging,
      });

      // sendPhoto called once (for status), NOT twice
      expect(mockMessaging.sendPhoto).toHaveBeenCalledTimes(1);

      // Caption updated in-place with food list + buttons
      expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
        '200', // messageId from sendPhoto
        expect.objectContaining({
          caption: expect.any(String),
          choices: expect.any(Array),
        })
      );

      // Status message should NOT be deleted (photo stays)
      expect(mockMessaging.deleteMessage).not.toHaveBeenCalled();
    });

    it('updates photo caption with error on failure (no food detected)', async () => {
      mockAI.chatWithImage = jest.fn().mockResolvedValue('No food visible in this image.');

      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
        responseContext: mockMessaging,
      });

      // Photo was sent with status caption
      expect(mockMessaging.sendPhoto).toHaveBeenCalledTimes(1);

      // Caption updated with error message (not text update)
      expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({
          caption: expect.stringContaining("couldn't identify"),
        })
      );

      // No text message sent
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });
  });
});
