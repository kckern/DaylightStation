/**
 * Test Adapter Tests
 * @group integration
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { TestAdapter } from '../helpers/TestAdapter.mjs';

// Mock event router
const createMockRouter = () => ({
  route: jest.fn().mockResolvedValue(undefined),
});

// Mock container
const createMockContainer = () => ({
  getMessagingGateway: jest.fn().mockReturnValue({
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  }),
  getConversationStateStore: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(null),
  }),
});

describe('TestAdapter', () => {
  let adapter;
  let mockRouter;
  let mockContainer;

  beforeEach(() => {
    mockRouter = createMockRouter();
    mockContainer = createMockContainer();

    adapter = new TestAdapter({
      bot: 'nutribot',
      container: mockContainer,
      router: mockRouter,
    });
  });

  it('should require bot type', () => {
    expect(() => new TestAdapter({
      container: mockContainer,
      router: mockRouter,
    })).toThrow('bot');
  });

  it('should require container', () => {
    expect(() => new TestAdapter({
      bot: 'nutribot',
      router: mockRouter,
    })).toThrow('container');
  });

  it('should require router', () => {
    expect(() => new TestAdapter({
      bot: 'nutribot',
      container: mockContainer,
    })).toThrow('router');
  });

  describe('sendText', () => {
    it('should route text message event', async () => {
      await adapter.sendText('Hello world');

      expect(mockRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            text: 'Hello world',
          }),
        })
      );
    });

    it('should include chat and from info', async () => {
      await adapter.sendText('Test');

      const event = mockRouter.route.mock.calls[0][0];
      expect(event.message.chat.id).toBeDefined();
      expect(event.message.from).toBeDefined();
    });
  });

  describe('sendPhoto', () => {
    it('should route photo message event', async () => {
      await adapter.sendPhoto('base64data');

      expect(mockRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            photo: expect.arrayContaining([
              expect.objectContaining({ file_id: expect.any(String) }),
            ]),
          }),
        })
      );
    });
  });

  describe('sendVoice', () => {
    it('should route voice message event', async () => {
      await adapter.sendVoice();

      expect(mockRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            voice: expect.objectContaining({
              file_id: expect.any(String),
              duration: expect.any(Number),
            }),
          }),
        })
      );
    });
  });

  describe('sendCommand', () => {
    it('should add leading slash if missing', async () => {
      await adapter.sendCommand('help');

      expect(mockRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            text: '/help',
          }),
        })
      );
    });

    it('should keep slash if present', async () => {
      await adapter.sendCommand('/report');

      expect(mockRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            text: '/report',
          }),
        })
      );
    });
  });

  describe('pressButton', () => {
    it('should throw if no messages', async () => {
      await expect(adapter.pressButton('Accept')).rejects.toThrow('No buttons');
    });
  });

  describe('assertions', () => {
    it('should return null for getLastBotMessage when empty', () => {
      expect(adapter.getLastBotMessage()).toBeNull();
    });

    it('should return 0 for initial message count', () => {
      expect(adapter.getMessagesCount()).toBe(0);
      expect(adapter.getBotMessagesCount()).toBe(0);
    });

    it('should return user ID', () => {
      expect(adapter.getUserId()).toBeDefined();
      expect(adapter.getUserId()).toContain('test_');
    });
  });

  describe('reset', () => {
    it('should clear messages on reset', async () => {
      await adapter.sendText('Test');
      expect(mockRouter.route).toHaveBeenCalled();

      adapter.reset();
      expect(adapter.getMessagesCount()).toBe(0);
    });
  });

  describe('AI responses', () => {
    it('should allow setting AI responses', () => {
      adapter.setAIResponse(/food/i, 'Detected: Apple');
      adapter.clearAIResponses();
      // No error thrown
    });
  });
});
