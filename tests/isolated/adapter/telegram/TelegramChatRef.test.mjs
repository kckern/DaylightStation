import { describe, it, expect } from 'vitest';
import { TelegramChatRef } from '#adapters/telegram/TelegramChatRef.mjs';

describe('TelegramChatRef', () => {
  describe('platformUserId', () => {
    it('returns chatId as platformUserId', () => {
      const ref = new TelegramChatRef('6898194425', '575596036');

      expect(ref.platformUserId).toBe('575596036');
    });

    it('platformUserId is independent of botId', () => {
      const ref1 = new TelegramChatRef('6898194425', '575596036');
      const ref2 = new TelegramChatRef('9999999999', '575596036');

      expect(ref1.platformUserId).toBe(ref2.platformUserId);
    });
  });
});
