/**
 * Mock AI Gateway Tests
 * @module cli/__tests__/MockAIGateway.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MockAIGateway } from '../mocks/MockAIGateway.mjs';

describe('MockAIGateway', () => {
  let aiGateway;

  beforeEach(() => {
    aiGateway = new MockAIGateway({ responseDelay: 0 }); // No delay for tests
  });

  describe('chat', () => {
    it('should return canned response for chicken salad', async () => {
      const messages = [{ role: 'user', content: 'I had a chicken salad for lunch' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThan(0);
      expect(parsed.items.some(i => i.name.toLowerCase().includes('chicken'))).toBe(true);
    });

    it('should return canned response for pizza', async () => {
      const messages = [{ role: 'user', content: 'I ate pizza' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items).toBeDefined();
      expect(parsed.items.some(i => i.name.toLowerCase().includes('pizza'))).toBe(true);
    });

    it('should return canned response for burger', async () => {
      const messages = [{ role: 'user', content: 'had a burger and fries' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should return canned response for apple', async () => {
      const messages = [{ role: 'user', content: 'I ate an apple' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items.some(i => i.name.toLowerCase().includes('apple'))).toBe(true);
    });

    it('should return canned response for coffee', async () => {
      const messages = [{ role: 'user', content: 'had a latte this morning' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items.some(i => i.name.toLowerCase().includes('latte'))).toBe(true);
    });

    it('should return default response for unknown food', async () => {
      const messages = [{ role: 'user', content: 'some weird alien food' }];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThan(0);
    });

    it('should extract last user message', async () => {
      const messages = [
        { role: 'system', content: 'You are a food assistant' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'I ate eggs for breakfast' },
      ];
      
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items.some(i => i.name.toLowerCase().includes('egg'))).toBe(true);
    });
  });

  describe('chatWithImage', () => {
    it('should return generic image response', async () => {
      const messages = [{ role: 'user', content: 'What food is in this image?' }];
      
      const response = await aiGateway.chatWithImage(messages, 'http://example.com/food.jpg');
      const parsed = JSON.parse(response);
      
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThan(0);
    });
  });

  describe('custom mock responses', () => {
    it('should return custom response for trigger', async () => {
      const customResponse = {
        items: [
          { name: 'Custom Food', calories: 999 },
        ],
      };
      
      aiGateway.setMockResponse('custom trigger', customResponse);
      
      const messages = [{ role: 'user', content: 'I had some custom trigger food' }];
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items[0].name).toBe('Custom Food');
      expect(parsed.items[0].calories).toBe(999);
    });

    it('should clear custom responses', async () => {
      aiGateway.setMockResponse('test', { items: [{ name: 'Test' }] });
      aiGateway.clearMockResponses();
      
      const messages = [{ role: 'user', content: 'test' }];
      const response = await aiGateway.chat(messages);
      const parsed = JSON.parse(response);
      
      expect(parsed.items[0].name).not.toBe('Test');
    });
  });

  describe('configuration', () => {
    it('should toggle real API mode', () => {
      expect(aiGateway).toBeDefined();
      
      // Should not throw
      aiGateway.setUseRealAPI(true);
      aiGateway.setUseRealAPI(false);
    });

    it('should set response delay', () => {
      aiGateway.setResponseDelay(100);
      // No assertion needed - just verify it doesn't throw
    });
  });
});
