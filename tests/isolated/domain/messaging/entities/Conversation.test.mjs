// tests/isolated/domain/messaging/entities/Conversation.test.mjs
import { Conversation } from '#domains/messaging/entities/Conversation.mjs';
import { Message } from '#domains/messaging/entities/Message.mjs';

describe('Conversation', () => {
  let conversation;
  const testTimestamp = '2026-01-11T12:00:00.000Z';

  const makeMessage = (overrides = {}) => new Message({
    id: overrides.id || `msg-${Math.random().toString(36).slice(2, 8)}`,
    senderId: 'john',
    content: 'Hello!',
    timestamp: testTimestamp,
    ...overrides
  });

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

    test('normalizes plain message objects to Message entities', () => {
      const conv = new Conversation({
        id: 'conv-002',
        participants: ['john', 'jane'],
        startedAt: '2026-01-11T10:00:00Z',
        messages: [
          { id: 'msg-1', senderId: 'john', content: 'Hi', timestamp: testTimestamp }
        ]
      });
      expect(conv.messages[0]).toBeInstanceOf(Message);
      expect(conv.messages[0].content).toBe('Hi');
    });
  });

  describe('addMessage', () => {
    test('adds a Message entity and updates lastMessageAt', () => {
      conversation.addMessage(makeMessage({ content: 'Hello!' }));
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0]).toBeInstanceOf(Message);
      expect(conversation.lastMessageAt).toBe(testTimestamp);
    });

    test('throws if given a plain object instead of a Message entity', () => {
      expect(() => conversation.addMessage({
        senderId: 'john',
        content: 'Hello!',
        timestamp: testTimestamp
      })).toThrow('addMessage requires a Message entity');
    });
  });

  describe('getMessageCount', () => {
    test('returns message count', () => {
      conversation.addMessage(makeMessage({ senderId: 'john', content: 'Hi' }));
      conversation.addMessage(makeMessage({ senderId: 'jane', content: 'Hello' }));
      expect(conversation.getMessageCount()).toBe(2);
    });
  });

  describe('getMessagesByParticipant', () => {
    test('filters by senderId', () => {
      conversation.addMessage(makeMessage({ senderId: 'john', content: 'Hi' }));
      conversation.addMessage(makeMessage({ senderId: 'jane', content: 'Hello' }));
      conversation.addMessage(makeMessage({ senderId: 'john', content: 'How are you?' }));

      const johnMessages = conversation.getMessagesByParticipant('john');
      expect(johnMessages).toHaveLength(2);
    });
  });

  describe('getLatestMessage', () => {
    test('returns last message', () => {
      conversation.addMessage(makeMessage({ senderId: 'john', content: 'First' }));
      conversation.addMessage(makeMessage({ senderId: 'jane', content: 'Last' }));
      expect(conversation.getLatestMessage().content).toBe('Last');
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

  describe('toJSON (transitional API DTO)', () => {
    test('serializes messages to plain objects and round-trips via constructor', () => {
      conversation.addMessage(makeMessage({ id: 'msg-1', senderId: 'john', content: 'Test' }));
      const json = conversation.toJSON();

      expect(json.messages[0]).not.toBeInstanceOf(Message);
      expect(json.messages[0].content).toBe('Test');

      // Datastores hydrate via the constructor; static fromJSON was removed
      // (serialization-ownership migration, phase 1)
      const restored = new Conversation(json);
      expect(restored.id).toBe(conversation.id);
      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0]).toBeInstanceOf(Message);
    });
  });
});
