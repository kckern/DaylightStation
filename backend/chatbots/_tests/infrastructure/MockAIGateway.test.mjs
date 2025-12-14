/**
 * Tests for MockAIGateway
 * @group Phase2
 */

import { MockAIGateway } from '../../infrastructure/ai/MockAIGateway.mjs';
import { isAIGateway } from '../../application/ports/IAIGateway.mjs';

describe('Phase2: MockAIGateway', () => {
  let gateway;

  beforeEach(() => {
    gateway = new MockAIGateway();
  });

  describe('interface compliance', () => {
    it('should implement IAIGateway', () => {
      expect(isAIGateway(gateway)).toBe(true);
    });
  });

  describe('chat', () => {
    it('should return default response', async () => {
      const result = await gateway.chat([
        { role: 'user', content: 'Hello' },
      ]);
      
      expect(result).toBe('Mock response');
    });

    it('should return configured response', async () => {
      gateway.setResponse('hello', 'Hi there!');
      
      const result = await gateway.chat([
        { role: 'user', content: 'Say hello' },
      ]);
      
      expect(result).toBe('Hi there!');
    });

    it('should match regex patterns', async () => {
      gateway.setResponse(/food|nutrition/i, 'Nutrition response');
      
      const result = await gateway.chat([
        { role: 'user', content: 'Tell me about food' },
      ]);
      
      expect(result).toBe('Nutrition response');
    });

    it('should record calls', async () => {
      await gateway.chat([
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ], { temperature: 0.5 });
      
      const call = gateway.getLastCall();
      expect(call.method).toBe('chat');
      expect(call.messages).toHaveLength(2);
      expect(call.options.temperature).toBe(0.5);
    });
  });

  describe('chatWithImage', () => {
    it('should return default response', async () => {
      const result = await gateway.chatWithImage(
        [{ role: 'user', content: 'What is this?' }],
        'https://example.com/img.jpg'
      );
      
      expect(result).toBe('Mock response');
    });

    it('should record image URL', async () => {
      await gateway.chatWithImage(
        [{ role: 'user', content: 'Analyze' }],
        'https://example.com/food.jpg'
      );
      
      const call = gateway.getLastCall();
      expect(call.method).toBe('chatWithImage');
      expect(call.imageUrl).toBe('https://example.com/food.jpg');
    });
  });

  describe('chatWithJson', () => {
    it('should return default JSON response', async () => {
      const result = await gateway.chatWithJson([
        { role: 'user', content: 'Give me JSON' },
      ]);
      
      expect(result).toEqual({ success: true });
    });

    it('should return configured JSON response', async () => {
      gateway.setJsonResponse('food', { calories: 100, protein: 5 });
      
      const result = await gateway.chatWithJson([
        { role: 'user', content: 'Analyze this food' },
      ]);
      
      expect(result.calories).toBe(100);
      expect(result.protein).toBe(5);
    });

    it('should deep copy response', async () => {
      const original = { items: [1, 2, 3] };
      gateway.setDefaultJsonResponse(original);
      
      const result = await gateway.chatWithJson([
        { role: 'user', content: 'test' },
      ]);
      
      result.items.push(4);
      
      // Original should not be modified
      expect(original.items).toEqual([1, 2, 3]);
    });
  });

  describe('transcribe', () => {
    it('should return default transcription', async () => {
      const buffer = Buffer.from('audio data');
      const result = await gateway.transcribe(buffer);
      
      expect(result).toBe('Mock transcription');
    });

    it('should record buffer size', async () => {
      const buffer = Buffer.from('audio data');
      await gateway.transcribe(buffer, { language: 'en' });
      
      const call = gateway.getLastCall();
      expect(call.method).toBe('transcribe');
      expect(call.bufferSize).toBe(buffer.length);
      expect(call.options.language).toBe('en');
    });

    it('should return configured transcription', async () => {
      gateway.setDefaultTranscription('I had chicken for lunch');
      
      const result = await gateway.transcribe(Buffer.from('audio'));
      expect(result).toBe('I had chicken for lunch');
    });
  });

  describe('embed', () => {
    it('should return embedding vector', async () => {
      const result = await gateway.embed('test text');
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1536);
    });

    it('should record call', async () => {
      await gateway.embed('sample text');
      
      const call = gateway.getLastCall();
      expect(call.method).toBe('embed');
      expect(call.text).toBe('sample text');
    });
  });

  describe('testing helpers', () => {
    it('getCalls should return all calls', async () => {
      await gateway.chat([{ role: 'user', content: '1' }]);
      await gateway.chatWithJson([{ role: 'user', content: '2' }]);
      
      expect(gateway.getCalls()).toHaveLength(2);
    });

    it('getCallsByMethod should filter', async () => {
      await gateway.chat([{ role: 'user', content: '1' }]);
      await gateway.chatWithJson([{ role: 'user', content: '2' }]);
      await gateway.chat([{ role: 'user', content: '3' }]);
      
      expect(gateway.getCallsByMethod('chat')).toHaveLength(2);
      expect(gateway.getCallsByMethod('chatWithJson')).toHaveLength(1);
    });

    it('assertCalledWith should pass for matching call', async () => {
      await gateway.chat([{ role: 'user', content: 'hello world' }]);
      
      expect(() => gateway.assertCalledWith('hello')).not.toThrow();
    });

    it('assertCalledWith should throw for no match', async () => {
      await gateway.chat([{ role: 'user', content: 'hello' }]);
      
      expect(() => gateway.assertCalledWith('goodbye'))
        .toThrow(/Expected call.*not found/);
    });

    it('callCount should return count', async () => {
      expect(gateway.callCount).toBe(0);
      await gateway.chat([{ role: 'user', content: 'test' }]);
      expect(gateway.callCount).toBe(1);
    });

    it('reset should clear all state', async () => {
      gateway.setResponse('x', 'y');
      gateway.setJsonResponse('a', { b: 1 });
      await gateway.chat([{ role: 'user', content: 'test' }]);
      
      gateway.reset();
      
      expect(gateway.callCount).toBe(0);
      // Responses should be cleared too
      const result = await gateway.chat([{ role: 'user', content: 'x' }]);
      expect(result).toBe('Mock response'); // Default
    });
  });

  describe('error simulation', () => {
    it('should throw simulated error', async () => {
      gateway.simulateError(new Error('API error'));
      
      await expect(gateway.chat([{ role: 'user', content: 'test' }]))
        .rejects.toThrow('API error');
    });

    it('should clear error after throwing', async () => {
      gateway.simulateError(new Error('Once'));
      
      await expect(gateway.chat([{ role: 'user', content: 'test' }]))
        .rejects.toThrow();
      
      // Second call should succeed
      const result = await gateway.chat([{ role: 'user', content: 'test' }]);
      expect(result).toBeDefined();
    });
  });

  describe('latency simulation', () => {
    it('should delay responses', async () => {
      gateway.setLatency(50);
      
      const start = Date.now();
      await gateway.chat([{ role: 'user', content: 'test' }]);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
    });
  });
});
