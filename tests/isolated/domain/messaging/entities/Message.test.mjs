// tests/unit/domains/messaging/entities/Message.test.mjs
import { Message, MESSAGE_TYPES } from '#domains/messaging/entities/Message.mjs';

describe('Message', () => {
  const testTimestamp = '2026-01-11T12:00:00.000Z';

  describe('constructor', () => {
    test('creates message with required fields', () => {
      const msg = new Message({
        id: 'msg-123',
        conversationId: 'conv-456',
        senderId: 'user-1',
        recipientId: 'user-2',
        content: 'Hello world',
        timestamp: testTimestamp
      });

      expect(msg.id).toBe('msg-123');
      expect(msg.conversationId).toBe('conv-456');
      expect(msg.senderId).toBe('user-1');
      expect(msg.recipientId).toBe('user-2');
      expect(msg.content).toBe('Hello world');
      expect(msg.type).toBe('text');
    });

    test('throws if timestamp not provided', () => {
      expect(() => new Message({ id: '1', content: 'test' })).toThrow('timestamp required');
    });

    test('defaults metadata to empty object', () => {
      const msg = new Message({ id: '1', content: 'test', timestamp: testTimestamp });
      expect(msg.metadata).toEqual({});
    });
  });

  describe('type checks', () => {
    test('isText returns true for text messages', () => {
      const msg = new Message({ id: '1', type: 'text', content: 'hello', timestamp: testTimestamp });
      expect(msg.isText()).toBe(true);
      expect(msg.isVoice()).toBe(false);
    });

    test('isVoice returns true for voice messages', () => {
      const msg = new Message({ id: '1', type: 'voice', content: { fileId: 'f1' }, timestamp: testTimestamp });
      expect(msg.isVoice()).toBe(true);
      expect(msg.isText()).toBe(false);
    });

    test('isImage returns true for image messages', () => {
      const msg = new Message({ id: '1', type: 'image', content: { fileId: 'f1' }, timestamp: testTimestamp });
      expect(msg.isImage()).toBe(true);
    });

    test('isCallback returns true for callback messages', () => {
      const msg = new Message({ id: '1', type: 'callback', content: 'button_1', timestamp: testTimestamp });
      expect(msg.isCallback()).toBe(true);
    });
  });

  describe('getText', () => {
    test('returns text content for text messages', () => {
      const msg = new Message({ id: '1', type: 'text', content: 'hello', timestamp: testTimestamp });
      expect(msg.getText()).toBe('hello');
    });

    test('returns callback data for callback messages', () => {
      const msg = new Message({ id: '1', type: 'callback', content: 'option_1', timestamp: testTimestamp });
      expect(msg.getText()).toBe('option_1');
    });

    test('returns caption for image messages', () => {
      const msg = new Message({
        id: '1',
        type: 'image',
        content: { fileId: 'f1' },
        metadata: { caption: 'Nice photo' },
        timestamp: testTimestamp
      });
      expect(msg.getText()).toBe('Nice photo');
    });

    test('handles object content with text property', () => {
      const msg = new Message({
        id: '1',
        type: 'text',
        content: { text: 'extracted text' },
        timestamp: testTimestamp
      });
      expect(msg.getText()).toBe('extracted text');
    });
  });

  describe('age methods', () => {
    test('getAgeMs returns age in milliseconds', () => {
      const now = Date.now();
      const pastTime = new Date(now - 5000).toISOString();
      const msg = new Message({ id: '1', timestamp: pastTime, content: 'test' });

      expect(msg.getAgeMs(now)).toBeGreaterThanOrEqual(4900);
      expect(msg.getAgeMs(now)).toBeLessThan(6000);
    });

    test('getAgeMs throws if nowMs not provided', () => {
      const msg = new Message({ id: '1', timestamp: testTimestamp, content: 'test' });
      expect(() => msg.getAgeMs()).toThrow('nowMs timestamp required');
    });

    test('getAgeMinutes returns age in minutes', () => {
      const now = Date.now();
      const pastTime = new Date(now - 120000).toISOString(); // 2 minutes ago
      const msg = new Message({ id: '1', timestamp: pastTime, content: 'test' });

      expect(msg.getAgeMinutes(now)).toBe(2);
    });

    test('isRecent returns true for recent messages', () => {
      const now = Date.now();
      const recentTime = new Date(now).toISOString();
      const msg = new Message({ id: '1', content: 'test', timestamp: recentTime });
      expect(msg.isRecent(now, 5)).toBe(true);
    });

    test('isRecent returns false for old messages', () => {
      const now = Date.now();
      const pastTime = new Date(now - 600000).toISOString(); // 10 minutes ago
      const msg = new Message({ id: '1', timestamp: pastTime, content: 'test' });
      expect(msg.isRecent(now, 5)).toBe(false);
    });
  });

  describe('isFrom', () => {
    test('returns true when sender matches', () => {
      const msg = new Message({ id: '1', senderId: 'user-1', content: 'test', timestamp: testTimestamp });
      expect(msg.isFrom('user-1')).toBe(true);
    });

    test('returns false when sender does not match', () => {
      const msg = new Message({ id: '1', senderId: 'user-1', content: 'test', timestamp: testTimestamp });
      expect(msg.isFrom('user-2')).toBe(false);
    });
  });

  describe('constructor hydration', () => {
    test('accepts a plain message record', () => {
      const original = new Message({
        id: 'msg-123',
        conversationId: 'conv-456',
        senderId: 'user-1',
        recipientId: 'user-2',
        type: 'text',
        content: 'Hello',
        timestamp: '2026-01-11T12:00:00.000Z',
        metadata: { edited: true }
      });

      const record = {
        id: original.id,
        conversationId: original.conversationId,
        senderId: original.senderId,
        recipientId: original.recipientId,
        type: original.type,
        direction: original.direction,
        content: original.content,
        attachments: original.attachments,
        timestamp: original.timestamp,
        metadata: original.metadata
      };
      const restored = new Message(record);

      expect(restored.id).toBe(original.id);
      expect(restored.conversationId).toBe(original.conversationId);
      expect(restored.content).toBe(original.content);
      expect(restored.metadata).toEqual(original.metadata);
    });
  });

  describe('static factory methods', () => {
    test('createText creates text message', () => {
      const msg = Message.createText({
        id: 'msg-1704969600000-fixed01',
        conversationId: 'conv-1',
        senderId: 'user-1',
        recipientId: 'user-2',
        text: 'Hello there',
        timestamp: testTimestamp,
      });

      expect(msg.type).toBe('text');
      expect(msg.content).toBe('Hello there');
      expect(msg.id).toBe('msg-1704969600000-fixed01');
    });

    test('createVoice creates voice message', () => {
      const msg = Message.createVoice({
        id: 'msg-voice-fixed',
        conversationId: 'conv-1',
        senderId: 'user-1',
        recipientId: 'user-2',
        fileId: 'file-123',
        duration: 5,
        timestamp: testTimestamp,
      });

      expect(msg.type).toBe('voice');
      expect(msg.content).toEqual({ fileId: 'file-123', duration: 5 });
    });

    test('createImage creates image message', () => {
      const msg = Message.createImage({
        id: 'msg-image-fixed',
        conversationId: 'conv-1',
        senderId: 'user-1',
        recipientId: 'user-2',
        fileId: 'file-123',
        caption: 'Nice photo',
        timestamp: testTimestamp,
      });

      expect(msg.type).toBe('image');
      expect(msg.content).toEqual({ fileId: 'file-123' });
      expect(msg.metadata.caption).toBe('Nice photo');
    });

    test('createCallback creates callback message', () => {
      const msg = Message.createCallback({
        id: 'msg-callback-fixed',
        conversationId: 'conv-1',
        senderId: 'user-1',
        recipientId: 'user-2',
        callbackData: 'option_selected',
        timestamp: testTimestamp,
      });

      expect(msg.type).toBe('callback');
      expect(msg.content).toBe('option_selected');
    });
  });

});
