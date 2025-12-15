/**
 * CLIInputAdapter Tests
 * @module tests/cli/CLIInputAdapter.test
 */

import { CLIInputAdapter } from '../../cli/adapters/CLIInputAdapter.mjs';
import { InputEventType } from '../../application/ports/IInputEvent.mjs';

// Use Jest globals
const { describe, it, expect } = global;

describe('CLIInputAdapter', () => {
  const userId = 'user-123';
  const conversationId = 'cli:nutribot_session-456';
  const messageId = 'msg-1';

  describe('fromCLIInput()', () => {
    describe('TEXT input', () => {
      it('should convert TEXT input to text event', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'TEXT',
          { text: 'chicken salad' },
          userId,
          conversationId,
          messageId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.TEXT);
        expect(event.channel).toBe('cli');
        expect(event.userId).toBe(userId);
        expect(event.conversationId).toBe(conversationId);
        expect(event.messageId).toBe(messageId);
        expect(event.payload.text).toBe('chicken salad');
      });

      it('should handle lowercase type', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'text',
          { text: 'pizza' },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.TEXT);
        expect(event.payload.text).toBe('pizza');
      });

      it('should return null for empty text', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'TEXT',
          { text: '' },
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });

      it('should return null for missing text', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'TEXT',
          {},
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });
    });

    describe('PHOTO input', () => {
      it('should convert PHOTO input with localPath', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'PHOTO',
          { localPath: '/tmp/food.jpg' },
          userId,
          conversationId,
          messageId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.IMAGE);
        expect(event.payload.localPath).toBe('/tmp/food.jpg');
        expect(event.payload.url).toBe('/tmp/food.jpg');
      });

      it('should convert PHOTO input with URL', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'PHOTO',
          { url: 'https://example.com/food.jpg' },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.IMAGE);
        expect(event.payload.url).toBe('https://example.com/food.jpg');
      });

      it('should return null for null data', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'PHOTO',
          null,
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });
    });

    describe('VOICE input', () => {
      it('should convert VOICE input with localPath', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'VOICE',
          { localPath: '/tmp/voice.ogg', duration: 5 },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.VOICE);
        expect(event.payload.localPath).toBe('/tmp/voice.ogg');
        expect(event.payload.duration).toBe(5);
      });
    });

    describe('UPC input', () => {
      it('should convert UPC input', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'UPC',
          { upc: '012345678905' },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.UPC);
        expect(event.payload.upc).toBe('012345678905');
      });

      it('should return null for missing UPC', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'UPC',
          {},
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });
    });

    describe('COMMAND input', () => {
      it('should convert COMMAND input', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'COMMAND',
          { command: 'report', args: null },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.type).toBe(InputEventType.COMMAND);
        expect(event.payload.command).toBe('report');
        expect(event.payload.args).toBeNull();
      });

      it('should include args when present', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'COMMAND',
          { command: 'help', args: 'food' },
          userId,
          conversationId
        );

        expect(event).not.toBeNull();
        expect(event.payload.command).toBe('help');
        expect(event.payload.args).toBe('food');
      });
    });

    describe('BUTTON_PRESS input', () => {
      it('should return null for button press (handled separately)', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'BUTTON_PRESS',
          { buttonId: '1' },
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });
    });

    describe('unknown input types', () => {
      it('should return null for unknown types', () => {
        const event = CLIInputAdapter.fromCLIInput(
          'UNKNOWN',
          { data: 'test' },
          userId,
          conversationId
        );

        expect(event).toBeNull();
      });
    });
  });

  describe('fromButtonPress()', () => {
    it('should create callback event from button press', () => {
      const event = CLIInputAdapter.fromButtonPress(
        'accept:log-uuid-123',
        'msg-5',
        userId,
        conversationId
      );

      expect(event).not.toBeNull();
      expect(event.type).toBe(InputEventType.CALLBACK);
      expect(event.channel).toBe('cli');
      expect(event.userId).toBe(userId);
      expect(event.conversationId).toBe(conversationId);
      expect(event.messageId).toBeNull(); // Button press has no message ID
      expect(event.payload.data).toBe('accept:log-uuid-123');
      expect(event.payload.sourceMessageId).toBe('msg-5');
    });
  });

  describe('fromRevisionInput()', () => {
    it('should create text event for revision input', () => {
      const event = CLIInputAdapter.fromRevisionInput(
        'make it a turkey sandwich',
        userId,
        conversationId
      );

      expect(event).not.toBeNull();
      expect(event.type).toBe(InputEventType.TEXT);
      expect(event.channel).toBe('cli');
      expect(event.payload.text).toBe('make it a turkey sandwich');
    });
  });

  describe('buildConversationId()', () => {
    it('should build CLI conversation ID', () => {
      const convId = CLIInputAdapter.buildConversationId('session-123', 'nutribot');
      expect(convId).toBe('cli:nutribot_session-123');
    });

    it('should work with different bots', () => {
      const convId = CLIInputAdapter.buildConversationId('sess-456', 'journalist');
      expect(convId).toBe('cli:journalist_sess-456');
    });
  });

  describe('parseConversationId()', () => {
    it('should parse CLI conversation ID', () => {
      const result = CLIInputAdapter.parseConversationId('cli:nutribot_session-123');
      
      expect(result).not.toBeNull();
      expect(result.botName).toBe('nutribot');
      expect(result.sessionId).toBe('session-123');
    });

    it('should return null for non-CLI conversation IDs', () => {
      const result = CLIInputAdapter.parseConversationId('telegram:bot_123');
      expect(result).toBeNull();
    });

    it('should return null for invalid format', () => {
      const result = CLIInputAdapter.parseConversationId('invalid');
      expect(result).toBeNull();
    });
  });
});
