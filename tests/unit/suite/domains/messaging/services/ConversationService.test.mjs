// tests/unit/domains/messaging/services/ConversationService.test.mjs
import { jest } from '@jest/globals';
import { ConversationService } from '#domains/messaging/services/ConversationService.mjs';

describe('ConversationService', () => {
  let service;
  let mockStore;
  let mockLogger;

  beforeEach(() => {
    mockStore = {
      save: jest.fn(),
      findById: jest.fn(),
      findByParticipants: jest.fn(),
      findByParticipant: jest.fn(),
      findActive: jest.fn(),
      delete: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    service = new ConversationService({
      conversationStore: mockStore,
      logger: mockLogger
    });
  });

  describe('createConversation', () => {
    test('creates and saves conversation', async () => {
      const nowMs = Date.now();
      const conv = await service.createConversation({
        participants: ['user-1', 'user-2'],
        nowMs,
        metadata: { topic: 'test' }
      });

      expect(conv.id).toMatch(/^conv-/);
      expect(conv.participants).toEqual(['user-1', 'user-2']);
      expect(conv.metadata.topic).toBe('test');
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('throws if nowMs not provided', async () => {
      await expect(service.createConversation({
        participants: ['user-1', 'user-2']
      })).rejects.toThrow('nowMs timestamp required');
    });
  });

  describe('getConversation', () => {
    test('returns conversation by ID', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'conv-123',
        participants: ['user-1', 'user-2'],
        messages: [],
        startedAt: '2026-01-11T12:00:00.000Z'
      });

      const conv = await service.getConversation('conv-123');

      expect(conv.id).toBe('conv-123');
      expect(conv.participants).toHaveLength(2);
    });

    test('returns null for nonexistent conversation', async () => {
      mockStore.findById.mockResolvedValue(null);

      const conv = await service.getConversation('nonexistent');

      expect(conv).toBeNull();
    });
  });

  describe('getOrCreateConversation', () => {
    test('returns existing conversation', async () => {
      mockStore.findByParticipants.mockResolvedValue({
        id: 'conv-existing',
        participants: ['user-1', 'user-2'],
        messages: []
      });

      const nowMs = Date.now();
      const conv = await service.getOrCreateConversation(['user-1', 'user-2'], nowMs);

      expect(conv.id).toBe('conv-existing');
      expect(mockStore.save).not.toHaveBeenCalled();
    });

    test('creates new conversation if none exists', async () => {
      mockStore.findByParticipants.mockResolvedValue(null);

      const nowMs = Date.now();
      const conv = await service.getOrCreateConversation(['user-1', 'user-2'], nowMs);

      expect(conv.id).toMatch(/^conv-/);
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('addMessage', () => {
    test('adds message to conversation', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'conv-123',
        participants: ['user-1', 'user-2'],
        messages: [],
        startedAt: '2026-01-11T12:00:00.000Z'
      });

      const message = await service.addMessage('conv-123', {
        senderId: 'user-1',
        content: 'Hello',
        type: 'text'
      });

      expect(message.content).toBe('Hello');
      expect(message.conversationId).toBe('conv-123');
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('throws for nonexistent conversation', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(
        service.addMessage('nonexistent', { senderId: 'user-1', content: 'Hi' })
      ).rejects.toThrow('Conversation not found');
    });
  });

  describe('getMessages', () => {
    const conversationData = {
      id: 'conv-123',
      participants: ['user-1', 'user-2'],
      messages: [
        { id: 'msg-1', senderId: 'user-1', type: 'text', content: 'Hello', timestamp: '2026-01-11T12:00:00.000Z' },
        { id: 'msg-2', senderId: 'user-2', type: 'text', content: 'Hi', timestamp: '2026-01-11T12:01:00.000Z' },
        { id: 'msg-3', senderId: 'user-1', type: 'voice', content: {}, timestamp: '2026-01-11T12:02:00.000Z' }
      ],
      startedAt: '2026-01-11T12:00:00.000Z'
    };

    test('returns all messages', async () => {
      mockStore.findById.mockResolvedValue(conversationData);

      const messages = await service.getMessages('conv-123');

      expect(messages).toHaveLength(3);
    });

    test('filters by senderId', async () => {
      mockStore.findById.mockResolvedValue(conversationData);

      const messages = await service.getMessages('conv-123', { senderId: 'user-1' });

      expect(messages).toHaveLength(2);
      expect(messages.every(m => m.senderId === 'user-1')).toBe(true);
    });

    test('filters by type', async () => {
      mockStore.findById.mockResolvedValue(conversationData);

      const messages = await service.getMessages('conv-123', { type: 'voice' });

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('voice');
    });

    test('applies limit', async () => {
      mockStore.findById.mockResolvedValue(conversationData);

      const messages = await service.getMessages('conv-123', { limit: 2 });

      expect(messages).toHaveLength(2);
      // Should return last 2 messages
      expect(messages[0].id).toBe('msg-2');
      expect(messages[1].id).toBe('msg-3');
    });

    test('returns empty array for nonexistent conversation', async () => {
      mockStore.findById.mockResolvedValue(null);

      const messages = await service.getMessages('nonexistent');

      expect(messages).toEqual([]);
    });
  });

  describe('getConversationSummary', () => {
    test('returns summary with stats', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'conv-123',
        participants: ['user-1', 'user-2'],
        messages: [
          { id: 'msg-1', content: 'Hello' },
          { id: 'msg-2', content: 'Hi' }
        ],
        startedAt: '2026-01-11T12:00:00.000Z',
        lastMessageAt: '2026-01-11T12:01:00.000Z'
      });

      const summary = await service.getConversationSummary('conv-123');

      expect(summary.id).toBe('conv-123');
      expect(summary.messageCount).toBe(2);
      expect(summary.participants).toHaveLength(2);
    });

    test('returns null for nonexistent conversation', async () => {
      mockStore.findById.mockResolvedValue(null);

      const summary = await service.getConversationSummary('nonexistent');

      expect(summary).toBeNull();
    });
  });

  describe('archiveConversation', () => {
    test('marks conversation as archived', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'conv-123',
        participants: [],
        messages: [],
        metadata: {}
      });

      const conv = await service.archiveConversation('conv-123');

      expect(conv.metadata.archived).toBe(true);
      expect(conv.metadata.archivedAt).toBeDefined();
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('throws for nonexistent conversation', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(service.archiveConversation('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('deleteConversation', () => {
    test('deletes conversation', async () => {
      await service.deleteConversation('conv-123');

      expect(mockStore.delete).toHaveBeenCalledWith('conv-123');
    });
  });

  describe('getStatistics', () => {
    test('returns conversation statistics', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'conv-123',
        participants: ['user-1', 'user-2'],
        messages: [
          { senderId: 'user-1', type: 'text' },
          { senderId: 'user-1', type: 'text' },
          { senderId: 'user-2', type: 'voice' }
        ],
        startedAt: '2026-01-11T12:00:00.000Z',
        lastMessageAt: '2026-01-11T12:05:00.000Z'
      });

      const stats = await service.getStatistics('conv-123');

      expect(stats.totalMessages).toBe(3);
      expect(stats.byParticipant['user-1']).toBe(2);
      expect(stats.byParticipant['user-2']).toBe(1);
      expect(stats.byType.text).toBe(2);
      expect(stats.byType.voice).toBe(1);
    });
  });

  describe('generateConversationId', () => {
    test('generates unique IDs', () => {
      const nowMs = Date.now();
      const id1 = service.generateConversationId(nowMs);
      const id2 = service.generateConversationId(nowMs);

      expect(id1).toMatch(/^conv-/);
      expect(id1).not.toBe(id2);
    });

    test('throws if nowMs not provided', () => {
      expect(() => service.generateConversationId()).toThrow('nowMs timestamp required');
    });
  });
});
