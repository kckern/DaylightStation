// tests/unit/suite/adapters/telegram/IInputEvent.test.mjs
import { describe, it, expect } from '@jest/globals';
import { toInputEvent } from '#adapters/telegram/IInputEvent.mjs';

describe('toInputEvent', () => {
  describe('platformUserId extraction', () => {
    it('uses from.id for platformUserId even when telegramRef is provided', () => {
      const parsed = {
        type: 'callback',
        userId: 'telegram:123_456',
        callbackData: 'test',
        messageId: '999',
        metadata: {
          from: { id: 575596036, first_name: 'Test', username: 'testuser' },
          chatType: 'private',
        },
      };

      // Mock telegramRef with different chatId
      const telegramRef = {
        toConversationId: () => ({ toString: () => 'telegram:b123_c999' }),
        platformUserId: '999', // This is the CHAT ID, not user ID
      };

      const event = toInputEvent(parsed, telegramRef);

      // Should use from.id (575596036), not telegramRef.platformUserId (999)
      expect(event.platformUserId).toBe('575596036');
    });

    it('uses from.id when telegramRef is null', () => {
      const parsed = {
        type: 'text',
        userId: 'telegram:123_575596036',
        text: 'hello',
        messageId: '100',
        metadata: {
          from: { id: 575596036 },
          chatType: 'private',
        },
      };

      const event = toInputEvent(parsed, null);

      expect(event.platformUserId).toBe('575596036');
    });

    it('returns undefined platformUserId when from.id is missing', () => {
      const parsed = {
        type: 'text',
        userId: 'telegram:123_456',
        text: 'hello',
        messageId: '100',
        metadata: {},
      };

      const event = toInputEvent(parsed, null);

      expect(event.platformUserId).toBeUndefined();
    });
  });
});
