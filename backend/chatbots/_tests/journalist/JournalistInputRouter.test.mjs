/**
 * Journalist Input Router Tests
 * @module _tests/journalist/JournalistInputRouter.test
 * 
 * Tests for the new IInputEvent-based JournalistInputRouter.
 * These tests verify the router correctly handles platform-agnostic events.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { JournalistInputRouter } from '../../bots/journalist/adapters/JournalistInputRouter.mjs';
import { InputEventType } from '../../application/ports/IInputEvent.mjs';

// ==================== Mock Container ====================

function createMockContainer() {
  const processTextEntry = { execute: jest.fn().mockResolvedValue({ success: true }) };
  const processVoiceEntry = { execute: jest.fn().mockResolvedValue({ success: true }) };
  const handleSlashCommand = { execute: jest.fn().mockResolvedValue({ success: true }) };
  const handleSpecialStart = { execute: jest.fn().mockResolvedValue({ success: true }) };
  const handleCallbackResponse = { execute: jest.fn().mockResolvedValue({ success: true }) };

  return {
    getProcessTextEntry: jest.fn(() => processTextEntry),
    getProcessVoiceEntry: jest.fn(() => processVoiceEntry),
    getHandleSlashCommand: jest.fn(() => handleSlashCommand),
    getHandleSpecialStart: jest.fn(() => handleSpecialStart),
    getHandleCallbackResponse: jest.fn(() => handleCallbackResponse),
    _useCases: {
      processTextEntry,
      processVoiceEntry,
      handleSlashCommand,
      handleSpecialStart,
      handleCallbackResponse,
    },
  };
}

// ==================== Test Fixtures (IInputEvent format) ====================

const createTextEvent = (text, conversationId = 'telegram:123_456', messageId = '1') => ({
  type: InputEventType.TEXT,
  userId: '456',
  conversationId,
  messageId,
  payload: { text },
  metadata: {
    firstName: 'Test',
    username: 'testuser',
    senderId: '456',
  },
  channel: 'telegram',
  timestamp: new Date().toISOString(),
});

const createVoiceEvent = (conversationId = 'telegram:123_456', messageId = '1') => ({
  type: InputEventType.VOICE,
  userId: '456',
  conversationId,
  messageId,
  payload: {
    fileId: 'voice_file_abc123',
    duration: 5,
    mimeType: 'audio/ogg',
  },
  metadata: {
    firstName: 'Test',
    username: 'testuser',
    senderId: '456',
  },
  channel: 'telegram',
  timestamp: new Date().toISOString(),
});

const createCommandEvent = (command, args = undefined, conversationId = 'telegram:123_456') => ({
  type: InputEventType.COMMAND,
  userId: '456',
  conversationId,
  messageId: '1',
  payload: {
    command,
    args,
    rawText: args ? `/${command} ${args}` : `/${command}`,
  },
  metadata: {
    firstName: 'Test',
    username: 'testuser',
    senderId: '456',
  },
  channel: 'telegram',
  timestamp: new Date().toISOString(),
});

const createCallbackEvent = (data, conversationId = 'telegram:123_456', sourceMessageId = '10') => ({
  type: InputEventType.CALLBACK,
  userId: '456',
  conversationId,
  messageId: 'callback_123',
  payload: {
    data,
    sourceMessageId,
  },
  metadata: {
    firstName: 'Test',
    username: 'testuser',
    senderId: '456',
  },
  channel: 'telegram',
  timestamp: new Date().toISOString(),
});

// ==================== Tests ====================

describe('JournalistInputRouter', () => {
  let container;
  let router;

  beforeEach(() => {
    container = createMockContainer();
    router = new JournalistInputRouter(container);
  });

  describe('Text Events', () => {
    it('should route regular text to ProcessTextEntry', async () => {
      const event = createTextEvent('Today I felt happy about my progress');
      
      await router.route(event);

      expect(container.getProcessTextEntry).toHaveBeenCalled();
      expect(container._useCases.processTextEntry.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        text: 'Today I felt happy about my progress',
        messageId: '1',
        senderId: '456',
        senderName: 'Test',
      });
    });

    it('should route 🎲 special start to HandleSpecialStart', async () => {
      const event = createTextEvent('🎲');
      
      await router.route(event);

      expect(container.getHandleSpecialStart).toHaveBeenCalled();
      expect(container._useCases.handleSpecialStart.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        messageId: '1',
        text: '🎲',
      });
    });

    it('should route ❌ special start to HandleSpecialStart', async () => {
      const event = createTextEvent('❌');
      
      await router.route(event);

      expect(container.getHandleSpecialStart).toHaveBeenCalled();
    });

    it('should use firstName for senderName when available', async () => {
      const event = createTextEvent('Hello');
      event.metadata = { firstName: 'John', username: 'johnny', senderId: '789' };
      
      await router.route(event);

      expect(container._useCases.processTextEntry.execute).toHaveBeenCalledWith(
        expect.objectContaining({ senderName: 'John' })
      );
    });

    it('should fall back to username when firstName is missing', async () => {
      const event = createTextEvent('Hello');
      event.metadata = { username: 'johnny', senderId: '789' };
      
      await router.route(event);

      expect(container._useCases.processTextEntry.execute).toHaveBeenCalledWith(
        expect.objectContaining({ senderName: 'johnny' })
      );
    });
  });

  describe('Command Events', () => {
    it('should route /start command to HandleSlashCommand', async () => {
      const event = createCommandEvent('start');
      
      await router.route(event);

      expect(container.getHandleSlashCommand).toHaveBeenCalled();
      expect(container._useCases.handleSlashCommand.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        command: '/start',
      });
    });

    it('should route /review command', async () => {
      const event = createCommandEvent('review');
      
      await router.route(event);

      expect(container._useCases.handleSlashCommand.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        command: '/review',
      });
    });

    it('should include args in command when present', async () => {
      const event = createCommandEvent('search', 'happiness');
      
      await router.route(event);

      expect(container._useCases.handleSlashCommand.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        command: '/search happiness',
      });
    });
  });

  describe('Voice Events', () => {
    it('should route voice events to ProcessVoiceEntry', async () => {
      const event = createVoiceEvent('telegram:123_456', '5');
      
      await router.route(event);

      expect(container.getProcessVoiceEntry).toHaveBeenCalled();
      expect(container._useCases.processVoiceEntry.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        voiceFileId: 'voice_file_abc123',
        messageId: '5',
        senderId: '456',
        senderName: 'Test',
      });
    });
  });

  describe('Callback Events', () => {
    it('should route callback events to HandleCallbackResponse', async () => {
      const event = createCallbackEvent('quiz_answer:happy', 'telegram:123_456', '10');
      
      await router.route(event);

      expect(container.getHandleCallbackResponse).toHaveBeenCalled();
      expect(container._useCases.handleCallbackResponse.execute).toHaveBeenCalledWith({
        chatId: 'telegram:123_456',
        messageId: '10',
        callbackData: 'quiz_answer:happy',
        options: {
          senderId: '456',
          senderName: 'Test',
          foreignKey: null,
        },
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown event types gracefully', async () => {
      const event = {
        type: 'unknown_type',
        conversationId: 'telegram:123_456',
        payload: {},
      };
      
      const result = await router.route(event);
      
      expect(result).toBeNull();
      // Should not call any use case
      expect(container.getProcessTextEntry).not.toHaveBeenCalled();
    });

    it('should handle missing metadata gracefully', async () => {
      const event = createTextEvent('Hello');
      delete event.metadata;
      
      await router.route(event);

      expect(container._useCases.processTextEntry.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: 'unknown',
          senderName: 'User',
        })
      );
    });
  });
});
