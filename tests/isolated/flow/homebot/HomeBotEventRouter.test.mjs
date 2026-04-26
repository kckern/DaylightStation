// tests/unit/applications/homebot/HomeBotEventRouter.test.mjs
import { vi } from 'vitest';

describe('HomeBotEventRouter', () => {
  let router;
  let mockContainer;
  let mockProcessGratitudeInput;
  let mockAssignItemToUser;
  let mockToggleCategory;
  let mockCancelGratitudeInput;
  let mockLogger;

  beforeEach(async () => {
    // Create mock use cases
    mockProcessGratitudeInput = { execute: vi.fn().mockResolvedValue({ success: true }) };
    mockAssignItemToUser = { execute: vi.fn().mockResolvedValue({ success: true }) };
    mockToggleCategory = { execute: vi.fn().mockResolvedValue({ success: true }) };
    mockCancelGratitudeInput = { execute: vi.fn().mockResolvedValue({ success: true }) };

    // Create mock container with async getters
    mockContainer = {
      getProcessGratitudeInput: vi.fn().mockResolvedValue(mockProcessGratitudeInput),
      getAssignItemToUser: vi.fn().mockResolvedValue(mockAssignItemToUser),
      getToggleCategory: vi.fn().mockResolvedValue(mockToggleCategory),
      getCancelGratitudeInput: vi.fn().mockResolvedValue(mockCancelGratitudeInput)
    };

    mockLogger = { debug: vi.fn(), warn: vi.fn() };

    const { HomeBotEventRouter } = await import('#backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs');
    router = new HomeBotEventRouter(mockContainer, { logger: mockLogger });
  });

  describe('text events', () => {
    it('should route text events to ProcessGratitudeInput', async () => {
      const event = {
        type: 'text',
        conversationId: 'telegram:123',
        text: 'I am grateful for sunshine'
      };

      await router.route(event);

      expect(mockContainer.getProcessGratitudeInput).toHaveBeenCalled();
      expect(mockProcessGratitudeInput.execute).toHaveBeenCalledWith({
        conversationId: 'telegram:123',
        text: 'I am grateful for sunshine'
      });
    });
  });

  describe('voice events', () => {
    it('should route voice events to ProcessGratitudeInput with voiceFileId', async () => {
      const event = {
        type: 'voice',
        conversationId: 'telegram:123',
        fileId: 'voice_file_123'
      };

      await router.route(event);

      expect(mockContainer.getProcessGratitudeInput).toHaveBeenCalled();
      expect(mockProcessGratitudeInput.execute).toHaveBeenCalledWith({
        conversationId: 'telegram:123',
        voiceFileId: 'voice_file_123'
      });
    });
  });

  describe('callback events', () => {
    it('should route user callbacks to AssignItemToUser', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123',
        messageId: 'msg456',
        data: 'user:john'
      };

      await router.route(event);

      expect(mockContainer.getAssignItemToUser).toHaveBeenCalled();
      expect(mockAssignItemToUser.execute).toHaveBeenCalledWith({
        conversationId: 'telegram:123',
        messageId: 'msg456',
        username: 'john'
      });
    });

    it('should route category callbacks to ToggleCategory', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123',
        messageId: 'msg456',
        data: 'category:health'
      };

      await router.route(event);

      expect(mockContainer.getToggleCategory).toHaveBeenCalled();
      expect(mockToggleCategory.execute).toHaveBeenCalledWith({
        conversationId: 'telegram:123',
        messageId: 'msg456',
        category: 'health'
      });
    });

    it('should route cancel callbacks to CancelGratitudeInput', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123',
        messageId: 'msg456',
        data: 'cancel'
      };

      await router.route(event);

      expect(mockContainer.getCancelGratitudeInput).toHaveBeenCalled();
      expect(mockCancelGratitudeInput.execute).toHaveBeenCalledWith({
        conversationId: 'telegram:123',
        messageId: 'msg456'
      });
    });

    it('should return needsUserSelection for confirm callback', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123',
        messageId: 'msg456',
        data: 'confirm'
      };

      const result = await router.route(event);

      expect(result).toEqual({ action: 'confirm', needsUserSelection: true });
    });

    it('should return null for unknown callback data', async () => {
      const event = {
        type: 'callback',
        conversationId: 'telegram:123',
        messageId: 'msg456',
        data: 'unknown:data'
      };

      const result = await router.route(event);

      expect(result).toBeNull();
    });
  });

  describe('command events', () => {
    it('should handle /help command', async () => {
      const event = {
        type: 'command',
        conversationId: 'telegram:123',
        command: 'help'
      };

      const result = await router.route(event);

      expect(result).toEqual({
        type: 'help',
        text: 'Send me something you are grateful for!'
      });
    });

    it('should handle /start command', async () => {
      const event = {
        type: 'command',
        conversationId: 'telegram:123',
        command: 'start'
      };

      const result = await router.route(event);

      expect(result).toEqual({
        type: 'start',
        text: 'Welcome! Share what you are grateful for today.'
      });
    });

    it('should return null for unknown commands', async () => {
      const event = {
        type: 'command',
        conversationId: 'telegram:123',
        command: 'unknown'
      };

      const result = await router.route(event);

      expect(result).toBeNull();
    });
  });

  describe('unknown event types', () => {
    it('should log warning and return null for unknown event types', async () => {
      const event = {
        type: 'unknown_type',
        conversationId: 'telegram:123'
      };

      const result = await router.route(event);

      expect(mockLogger.warn).toHaveBeenCalledWith('homebot.unknownEventType', { type: 'unknown_type' });
      expect(result).toBeNull();
    });
  });

  describe('logging', () => {
    it('should log debug message when routing events', async () => {
      const event = {
        type: 'text',
        conversationId: 'telegram:123',
        text: 'test'
      };

      await router.route(event);

      expect(mockLogger.debug).toHaveBeenCalledWith('homebot.route', {
        type: 'text',
        conversationId: 'telegram:123'
      });
    });
  });
});

describe('InputEventType', () => {
  it('should export InputEventType enum', async () => {
    const { InputEventType } = await import('#backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs');

    expect(InputEventType.TEXT).toBe('text');
    expect(InputEventType.VOICE).toBe('voice');
    expect(InputEventType.CALLBACK).toBe('callback');
    expect(InputEventType.COMMAND).toBe('command');
  });
});
