// tests/unit/domains/messaging/entities/Conversation.test.mjs
import { Conversation } from '#backend/src/1_domains/messaging/entities/Conversation.mjs';

describe('Conversation', () => {
  let conversation;

  beforeEach(() => {
    conversation = new Conversation({
      id: 'conv-001',
      participants: ['john', 'jane'],
      startedAt: '2026-01-11T10:00:00Z'
    });
  });

  describe('constructor', () => {
    test('creates conversation with properties', () => {
      expect(conversation.id).toBe('conv-001');
      expect(conversation.participants).toHaveLength(2);
    });
  });

  describe('addMessage', () => {
    test('adds message with timestamp', () => {
      conversation.addMessage({
        senderId: 'john',
        text: 'Hello!'
      });
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.lastMessageAt).toBeDefined();
    });
  });

  describe('getMessageCount', () => {
    test('returns message count', () => {
      conversation.addMessage({ senderId: 'john', text: 'Hi' });
      conversation.addMessage({ senderId: 'jane', text: 'Hello' });
      expect(conversation.getMessageCount()).toBe(2);
    });
  });

  describe('getMessagesByParticipant', () => {
    test('filters by senderId', () => {
      conversation.addMessage({ senderId: 'john', text: 'Hi' });
      conversation.addMessage({ senderId: 'jane', text: 'Hello' });
      conversation.addMessage({ senderId: 'john', text: 'How are you?' });

      const johnMessages = conversation.getMessagesByParticipant('john');
      expect(johnMessages).toHaveLength(2);
    });
  });

  describe('getLatestMessage', () => {
    test('returns last message', () => {
      conversation.addMessage({ senderId: 'john', text: 'First' });
      conversation.addMessage({ senderId: 'jane', text: 'Last' });
      expect(conversation.getLatestMessage().text).toBe('Last');
    });

    test('returns null for empty', () => {
      expect(conversation.getLatestMessage()).toBeNull();
    });
  });

  describe('hasParticipant', () => {
    test('returns true for participant', () => {
      expect(conversation.hasParticipant('john')).toBe(true);
    });

    test('returns false for non-participant', () => {
      expect(conversation.hasParticipant('bob')).toBe(false);
    });
  });

  describe('addParticipant', () => {
    test('adds new participant', () => {
      conversation.addParticipant('bob');
      expect(conversation.participants).toContain('bob');
    });

    test('does not add duplicate', () => {
      conversation.addParticipant('john');
      expect(conversation.participants.filter(p => p === 'john')).toHaveLength(1);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips conversation data', () => {
      conversation.addMessage({ senderId: 'john', text: 'Test' });
      const json = conversation.toJSON();
      const restored = Conversation.fromJSON(json);
      expect(restored.id).toBe(conversation.id);
      expect(restored.messages).toHaveLength(1);
    });
  });
});
