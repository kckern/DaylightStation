// tests/unit/applications/homebot/ToggleCategory.test.mjs
import { jest } from '@jest/globals';

describe('ToggleCategory', () => {
  let useCase;
  let mockMessagingGateway;
  let mockStateStore;
  let mockLogger;

  beforeEach(async () => {
    // Reset modules to clear any cached instances
    jest.resetModules();

    mockMessagingGateway = {
      updateMessage: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined)
    };

    mockStateStore = {
      get: jest.fn().mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [
            { id: 'item1', text: 'Good health' },
            { id: 'item2', text: 'Family' }
          ],
          category: 'gratitude',
          confirmationMessageId: 'msg123'
        }
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined)
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const { ToggleCategory } = await import(
      '../../../../backend/src/3_applications/homebot/usecases/ToggleCategory.mjs'
    );

    useCase = new ToggleCategory({
      messagingGateway: mockMessagingGateway,
      conversationStateStore: mockStateStore,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('should throw if messagingGateway is not provided', async () => {
      const { ToggleCategory } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/ToggleCategory.mjs'
      );

      expect(() => new ToggleCategory({
        conversationStateStore: mockStateStore
      })).toThrow('messagingGateway is required');
    });

    it('should throw if conversationStateStore is not provided', async () => {
      const { ToggleCategory } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/ToggleCategory.mjs'
      );

      expect(() => new ToggleCategory({
        messagingGateway: mockMessagingGateway
      })).toThrow('conversationStateStore is required');
    });
  });

  describe('execute', () => {
    it('should toggle category from gratitude to hopes', async () => {
      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      // Should get the conversation state
      expect(mockStateStore.get).toHaveBeenCalledWith('telegram:123', 'msg123');

      // Should update state with new category
      expect(mockStateStore.set).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.objectContaining({
          flowState: expect.objectContaining({
            category: 'hopes'
          })
        })
      );

      // Should update the message to show new category
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('Hopes')
      );

      // Should return success with category info
      expect(result.success).toBe(true);
      expect(result.previousCategory).toBe('gratitude');
      expect(result.newCategory).toBe('hopes');
    });

    it('should toggle category from hopes to gratitude', async () => {
      mockStateStore.get.mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [{ id: 'item1', text: 'Learn guitar' }],
          category: 'hopes'
        }
      });

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockStateStore.set).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.objectContaining({
          flowState: expect.objectContaining({
            category: 'gratitude'
          })
        })
      );

      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('Gratitude')
      );

      expect(result.success).toBe(true);
      expect(result.previousCategory).toBe('hopes');
      expect(result.newCategory).toBe('gratitude');
    });

    it('should show error when no state exists', async () => {
      mockStateStore.get.mockResolvedValue(null);

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('state');

      // Should update message to show error
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('expired')
      );

      // Should not update state
      expect(mockStateStore.set).not.toHaveBeenCalled();
    });

    it('should default to gratitude when no category in state', async () => {
      mockStateStore.get.mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [{ id: 'item1', text: 'Good health' }]
          // no category property
        }
      });

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(result.success).toBe(true);
      expect(result.previousCategory).toBe('gratitude');
      expect(result.newCategory).toBe('hopes');
    });

    it('should allow explicit category override', async () => {
      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        category: 'hopes'
      });

      expect(result.success).toBe(true);
      expect(result.newCategory).toBe('hopes');
    });

    it('should include item list in updated message', async () => {
      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringMatching(/Good health/)
      );

      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringMatching(/Family/)
      );
    });

    it('should log execution steps', async () => {
      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'toggleCategory.start',
        expect.objectContaining({
          conversationId: 'telegram:123'
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'toggleCategory.complete',
        expect.objectContaining({
          conversationId: 'telegram:123',
          previousCategory: 'gratitude',
          newCategory: 'hopes'
        })
      );
    });

    it('should preserve other flowState properties when updating', async () => {
      mockStateStore.get.mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [{ id: 'item1', text: 'Good health' }],
          category: 'gratitude',
          confirmationMessageId: 'msg123',
          someOtherProperty: 'preserved'
        }
      });

      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockStateStore.set).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.objectContaining({
          flowState: expect.objectContaining({
            someOtherProperty: 'preserved'
          })
        })
      );
    });
  });
});
