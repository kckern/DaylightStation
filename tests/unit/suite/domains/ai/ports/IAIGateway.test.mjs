// tests/unit/domains/ai/ports/IAIGateway.test.mjs
import {
  IAIGateway,
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage
} from '#backend/src/1_domains/ai/ports/IAIGateway.mjs';

describe('IAIGateway', () => {
  describe('interface methods', () => {
    test('chat throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.chat([])).rejects.toThrow('must be implemented');
    });

    test('chatWithImage throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.chatWithImage([], 'url')).rejects.toThrow('must be implemented');
    });

    test('chatWithJson throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.chatWithJson([])).rejects.toThrow('must be implemented');
    });

    test('transcribe throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.transcribe(Buffer.from(''))).rejects.toThrow('must be implemented');
    });

    test('embed throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.embed('text')).rejects.toThrow('must be implemented');
    });

    test('isConfigured throws not implemented', () => {
      const gateway = new IAIGateway();
      expect(() => gateway.isConfigured()).toThrow('must be implemented');
    });
  });

  describe('isAIGateway', () => {
    test('returns true for valid implementation', () => {
      const mockGateway = {
        chat: () => {},
        chatWithImage: () => {},
        chatWithJson: () => {},
        transcribe: () => {},
        embed: () => {}
      };

      expect(isAIGateway(mockGateway)).toBe(true);
    });

    test('returns false for incomplete implementation', () => {
      const incomplete = {
        chat: () => {},
        chatWithImage: () => {}
        // missing other methods
      };

      expect(isAIGateway(incomplete)).toBe(false);
    });

    test('returns false for null', () => {
      expect(isAIGateway(null)).toBe(false);
    });

    test('returns false for non-object', () => {
      expect(isAIGateway('string')).toBe(false);
    });
  });

  describe('assertAIGateway', () => {
    test('returns gateway if valid', () => {
      const mockGateway = {
        chat: () => {},
        chatWithImage: () => {},
        chatWithJson: () => {},
        transcribe: () => {},
        embed: () => {}
      };

      expect(assertAIGateway(mockGateway)).toBe(mockGateway);
    });

    test('throws for invalid implementation', () => {
      const incomplete = { chat: () => {} };

      expect(() => assertAIGateway(incomplete)).toThrow('does not implement IAIGateway');
    });
  });

  describe('message helpers', () => {
    test('systemMessage creates system role message', () => {
      const msg = systemMessage('You are helpful');
      expect(msg).toEqual({ role: 'system', content: 'You are helpful' });
    });

    test('userMessage creates user role message', () => {
      const msg = userMessage('Hello');
      expect(msg).toEqual({ role: 'user', content: 'Hello' });
    });

    test('assistantMessage creates assistant role message', () => {
      const msg = assistantMessage('Hi there!');
      expect(msg).toEqual({ role: 'assistant', content: 'Hi there!' });
    });
  });
});
