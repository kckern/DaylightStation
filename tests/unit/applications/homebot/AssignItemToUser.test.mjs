// tests/unit/applications/homebot/AssignItemToUser.test.mjs
import { jest } from '@jest/globals';

describe('AssignItemToUser', () => {
  let useCase;
  let mockMessagingGateway;
  let mockStateStore;
  let mockGratitudeService;
  let mockHouseholdService;
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
      delete: jest.fn().mockResolvedValue(undefined)
    };

    mockGratitudeService = {
      addSelections: jest.fn().mockResolvedValue([
        { id: 'sel1', userId: 'user1', item: { id: 'item1', text: 'Good health' } },
        { id: 'sel2', userId: 'user1', item: { id: 'item2', text: 'Family' } }
      ])
    };

    mockHouseholdService = {
      getHouseholdId: jest.fn().mockReturnValue('household123'),
      getMemberByUsername: jest.fn().mockReturnValue({
        username: 'user1',
        displayName: 'User One'
      })
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const { AssignItemToUser } = await import(
      '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs'
    );

    useCase = new AssignItemToUser({
      messagingGateway: mockMessagingGateway,
      conversationStateStore: mockStateStore,
      gratitudeService: mockGratitudeService,
      householdService: mockHouseholdService,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('should throw if messagingGateway is not provided', async () => {
      const { AssignItemToUser } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs'
      );

      expect(() => new AssignItemToUser({
        conversationStateStore: mockStateStore,
        gratitudeService: mockGratitudeService,
        householdService: mockHouseholdService
      })).toThrow('messagingGateway is required');
    });

    it('should throw if conversationStateStore is not provided', async () => {
      const { AssignItemToUser } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs'
      );

      expect(() => new AssignItemToUser({
        messagingGateway: mockMessagingGateway,
        gratitudeService: mockGratitudeService,
        householdService: mockHouseholdService
      })).toThrow('conversationStateStore is required');
    });

    it('should throw if gratitudeService is not provided', async () => {
      const { AssignItemToUser } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs'
      );

      expect(() => new AssignItemToUser({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockStateStore,
        householdService: mockHouseholdService
      })).toThrow('gratitudeService is required');
    });

    it('should throw if householdService is not provided', async () => {
      const { AssignItemToUser } = await import(
        '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs'
      );

      expect(() => new AssignItemToUser({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockStateStore,
        gratitudeService: mockGratitudeService
      })).toThrow('householdService is required');
    });
  });

  describe('execute', () => {
    it('should save items and clear state on successful assignment', async () => {
      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      // Should get the conversation state
      expect(mockStateStore.get).toHaveBeenCalledWith('telegram:123', 'msg123');

      // Should get household ID
      expect(mockHouseholdService.getHouseholdId).toHaveBeenCalled();

      // Should save items to gratitude service
      expect(mockGratitudeService.addSelections).toHaveBeenCalledWith(
        'household123',
        'gratitude',
        'user1',
        [
          { id: 'item1', text: 'Good health' },
          { id: 'item2', text: 'Family' }
        ],
        undefined // timezone
      );

      // Should update the message to show success
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('2 gratitude items')
      );

      // Should clear the conversation state
      expect(mockStateStore.delete).toHaveBeenCalledWith('telegram:123', 'msg123');

      // Should return success
      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(2);
      expect(result.username).toBe('user1');
    });

    it('should show error when no state exists', async () => {
      mockStateStore.get.mockResolvedValue(null);

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('state');

      // Should update message to show error
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('expired')
      );

      // Should not save items or clear state
      expect(mockGratitudeService.addSelections).not.toHaveBeenCalled();
      expect(mockStateStore.delete).not.toHaveBeenCalled();
    });

    it('should show error when state has no items', async () => {
      mockStateStore.get.mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [],
          category: 'gratitude'
        }
      });

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('items');

      expect(mockGratitudeService.addSelections).not.toHaveBeenCalled();
    });

    it('should use display name in success message when available', async () => {
      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(mockHouseholdService.getMemberByUsername).toHaveBeenCalledWith('user1');
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('User One')
      );
    });

    it('should fallback to username when display name not available', async () => {
      mockHouseholdService.getMemberByUsername.mockReturnValue(null);

      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
        'telegram:123',
        'msg123',
        expect.stringContaining('user1')
      );
    });

    it('should handle hopes category', async () => {
      mockStateStore.get.mockResolvedValue({
        activeFlow: 'gratitude_input',
        flowState: {
          items: [{ id: 'item1', text: 'Learn guitar' }],
          category: 'hopes'
        }
      });

      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(mockGratitudeService.addSelections).toHaveBeenCalledWith(
        'household123',
        'hopes',
        'user1',
        [{ id: 'item1', text: 'Learn guitar' }],
        undefined
      );
    });

    it('should handle gratitude service errors gracefully', async () => {
      mockGratitudeService.addSelections.mockRejectedValue(new Error('Database error'));

      const result = await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('save');

      // Should still try to update message with error
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalled();

      // Should NOT clear state on error
      expect(mockStateStore.delete).not.toHaveBeenCalled();
    });

    it('should log execution steps', async () => {
      await useCase.execute({
        conversationId: 'telegram:123',
        messageId: 'msg123',
        username: 'user1'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'assignItemToUser.start',
        expect.objectContaining({
          conversationId: 'telegram:123',
          username: 'user1'
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'assignItemToUser.complete',
        expect.objectContaining({
          conversationId: 'telegram:123',
          itemCount: 2
        })
      );
    });
  });
});
