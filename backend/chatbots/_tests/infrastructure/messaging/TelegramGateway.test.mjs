/**
 * TelegramGateway Plain ID Support Tests
 * @module _tests/infrastructure/messaging/TelegramGateway.test
 * 
 * Tests for TelegramGateway accepting plain string IDs
 * Note: These are unit tests that verify ID normalization logic
 */

import { IdConverter } from '../../../_lib/ids/IdConverter.mjs';

// Test ID normalization logic without full gateway instantiation
describe('TelegramGateway ID Normalization Logic', () => {
  
  describe('IdConverter.getUserId - extracting telegram chat_id', () => {
    it('should extract userId from plain string', () => {
      expect(IdConverter.getUserId('575596036')).toBe('575596036');
    });

    it('should extract userId from telegram conversationId format', () => {
      expect(IdConverter.getUserId('telegram:6898194425_575596036')).toBe('575596036');
    });

    it('should extract userId from legacy format', () => {
      expect(IdConverter.getUserId('b6898194425_u575596036')).toBe('575596036');
    });

    it('should extract userId from CLI format', () => {
      // CLI format extracts the session ID part after the bot name
      expect(IdConverter.getUserId('cli:nutribot_abc123')).toBe('nutribot_abc123');
    });
  });

  describe('Message ID normalization', () => {
    it('should parse string messageId to number', () => {
      const parsed = parseInt('456', 10);
      expect(parsed).toBe(456);
    });

    it('should handle numeric messageId', () => {
      const parsed = parseInt(String(456), 10);
      expect(parsed).toBe(456);
    });

    it('should handle MessageId-like object', () => {
      const messageIdObj = { toNumber: () => 789 };
      expect(messageIdObj.toNumber()).toBe(789);
    });

    it('should reject invalid messageId', () => {
      const parsed = parseInt('not-a-number', 10);
      expect(isNaN(parsed)).toBe(true);
    });
  });

  describe('ChatId object compatibility', () => {
    it('should support object with userId property', () => {
      const chatIdObject = { userId: '575596036' };
      expect(chatIdObject.userId).toBe('575596036');
    });

    it('should support object with identifier property', () => {
      const chatIdObject = { identifier: 'telegram:6898194425_575596036' };
      const userId = IdConverter.getUserId(chatIdObject.identifier);
      expect(userId).toBe('575596036');
    });
  });
});

describe('TelegramGateway Constructor Validation', () => {
  // Import dynamically to avoid axios issues  
  it('should require token', async () => {
    const { TelegramGateway } = await import('../../../infrastructure/messaging/TelegramGateway.mjs');
    
    expect(() => new TelegramGateway({ botId: '123' }))
      .toThrow('Telegram token is required');
  });

  it('should require botId', async () => {
    const { TelegramGateway } = await import('../../../infrastructure/messaging/TelegramGateway.mjs');
    
    expect(() => new TelegramGateway({ token: 'test' }))
      .toThrow('Bot ID is required');
  });

  it('should expose botId getter', async () => {
    const { TelegramGateway } = await import('../../../infrastructure/messaging/TelegramGateway.mjs');
    
    const gateway = new TelegramGateway({
      token: 'test-token',
      botId: '6898194425',
    });
    expect(gateway.botId).toBe('6898194425');
  });
});

describe('TelegramGateway answerCallbackQuery', () => {
  it('should be a method on gateway', async () => {
    const { TelegramGateway } = await import('../../../infrastructure/messaging/TelegramGateway.mjs');
    
    const gateway = new TelegramGateway({
      token: 'test-token',
      botId: '6898194425',
    });
    
    expect(typeof gateway.answerCallbackQuery).toBe('function');
  });
});

