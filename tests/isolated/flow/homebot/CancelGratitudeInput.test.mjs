// tests/unit/applications/homebot/CancelGratitudeInput.test.mjs
import { jest } from '@jest/globals';

describe('CancelGratitudeInput', () => {
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

    const { CancelGratitudeInput } = await import('#backend/src/3_applications/homebot/usecases/CancelGratitudeInput.mjs');

    useCase = new CancelGratitudeInput({
      messagingGateway: mockMessagingGateway,
      conversationStateStore: mockStateStore,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('should throw if messagingGateway is not provided', async () => {
      const { CancelGratitudeInput } = await import('#backend/src/3_applications/homebot/usecases/CancelGratitudeInput.mjs');

      expect(() => new CancelGratitudeInput({
        conversationStateStore: mockStateStore
      })).toThrow('messagingGateway is required');
    });

    it('should throw if conversationStateStore is not provided', async () => {
      const { CancelGratitudeInput } = await import('#backend/src/3_applications/homebot/usecases/CancelGratitudeInput.mjs');

      expect(() => new CancelGratitudeInput({
        messagingGateway: mockMessagingGateway
      })).toThrow('conversationStateStore is required');
    });
  });

  describe('execute', () => {
    it('should update message and clear state on cancel', async () => {
      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      // Should get the conversation state
      expect(mockStateStore.get).toHaveBeenCalledWith('telegram:123', 'msg123');

      // Should update the message to show cancelled
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('cancelled')
      );

      // Should clear the conversation state
      expect(mockStateStore.delete).toHaveBeenCalledWith('telegram:123', 'msg123');

      // Should return success
      expect(result.success).toBe(true);
      expect(result.hadState).toBe(true);
    });

    it('should succeed even when no state exists', async () => {
      mockStateStore.get.mockResolvedValue(null);

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      // Should still update the message
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('cancelled')
      );

      // Should not try to delete state
      expect(mockStateStore.delete).not.toHaveBeenCalled();

      // Should return success with hadState false
      expect(result.success).toBe(true);
      expect(result.hadState).toBe(false);
    });

    it('should log execution steps', async () => {
      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'cancelGratitudeInput.start',
        expect.objectContaining({
          conversationId: 'telegram:123',
          messageId: 'msg123'
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'cancelGratitudeInput.complete',
        expect.objectContaining({
          conversationId: 'telegram:123',
          hadState: true
        })
      );
    });

    it('should log hadState false when no state exists', async () => {
      mockStateStore.get.mockResolvedValue(null);

      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'cancelGratitudeInput.complete',
        expect.objectContaining({
          hadState: false
        })
      );
    });

    it('should propagate errors from messaging gateway', async () => {
      mockMessagingGateway.updateMessage.mockRejectedValue(new Error('Network error'));

      await expect(useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      })).rejects.toThrow('Network error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'cancelGratitudeInput.error',
        expect.objectContaining({
          conversationId: 'telegram:123',
          error: 'Network error'
        })
      );
    });

    it('should propagate errors from state store', async () => {
      mockStateStore.delete.mockRejectedValue(new Error('Store error'));

      await expect(useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123'
      })).rejects.toThrow('Store error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'cancelGratitudeInput.error',
        expect.objectContaining({
          error: 'Store error'
        })
      );
    });
  });
});
