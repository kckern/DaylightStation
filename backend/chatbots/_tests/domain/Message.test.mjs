/**
 * Tests for Message entity
 * @group Phase1
 */

import { Message, MessageType, MessageDirection } from '../../domain/entities/Message.mjs';
import { ConversationId, ChatId } from '../../domain/value-objects/ChatId.mjs';
import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase1: Message', () => {
  const validProps = {
    conversationId: new ConversationId('telegram', 'b123_c456'),
    messageId: new MessageId('msg789'),
    type: MessageType.TEXT,
    direction: MessageDirection.INCOMING,
    content: { text: 'Hello' },
    metadata: { someKey: 'someValue' },
  };

  describe('constructor', () => {
    it('should create Message with valid props', () => {
      const message = new Message(validProps);
      
      expect(message.conversationId).toEqual(validProps.conversationId);
      expect(message.messageId).toEqual(validProps.messageId);
      expect(message.type).toBe(MessageType.TEXT);
      expect(message.direction).toBe(MessageDirection.INCOMING);
    });

    it('should convert plain objects to value objects', () => {
      const message = new Message({
        ...validProps,
        conversationId: { channel: 'telegram', identifier: 'b123_c456' },
        messageId: 'msg789',
      });
      
      expect(message.conversationId).toBeInstanceOf(ConversationId);
      expect(message.messageId).toBeInstanceOf(MessageId);
    });

    it('should support legacy chatId property', () => {
      const message = new Message({
        chatId: new ConversationId('telegram', 'b123_c456'),
        messageId: new MessageId('msg789'),
        type: MessageType.TEXT,
        direction: MessageDirection.INCOMING,
      });
      
      expect(message.conversationId).toBeInstanceOf(ConversationId);
      // chatId should be an alias for conversationId
      expect(message.chatId.equals(message.conversationId)).toBe(true);
    });

    it('should set default timestamp to now', () => {
      const before = Date.now();
      const message = new Message(validProps);
      const after = Date.now();
      
      expect(message.timestamp.toEpochMs()).toBeGreaterThanOrEqual(before);
      expect(message.timestamp.toEpochMs()).toBeLessThanOrEqual(after);
    });

    it('should accept custom timestamp', () => {
      const timestamp = new Timestamp('2024-06-15T12:00:00Z');
      const message = new Message({ ...validProps, timestamp });
      
      expect(message.timestamp.equals(timestamp)).toBe(true);
    });

    it('should throw ValidationError for missing conversationId', () => {
      expect(() => new Message({ ...validProps, conversationId: null, chatId: null }))
        .toThrow(ValidationError);
    });

    it('should throw ValidationError for missing messageId', () => {
      expect(() => new Message({ ...validProps, messageId: null }))
        .toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid type', () => {
      expect(() => new Message({ ...validProps, type: 'invalid' }))
        .toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid direction', () => {
      expect(() => new Message({ ...validProps, direction: 'invalid' }))
        .toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const message = new Message(validProps);
      expect(Object.isFrozen(message)).toBe(true);
      expect(Object.isFrozen(message.content)).toBe(true);
      expect(Object.isFrozen(message.metadata)).toBe(true);
    });
  });

  describe('content getters', () => {
    it('text should return text content', () => {
      const message = new Message({
        ...validProps,
        content: { text: 'Hello World' },
      });
      expect(message.text).toBe('Hello World');
    });

    it('text should return null if no text', () => {
      const message = new Message({
        ...validProps,
        content: {},
      });
      expect(message.text).toBeNull();
    });

    it('photo should return photo attachment', () => {
      const photo = { fileId: 'file123', width: 800, height: 600 };
      const message = new Message({
        ...validProps,
        type: MessageType.PHOTO,
        content: { photo },
      });
      // photo getter now returns an Attachment object
      expect(message.photo).not.toBeNull();
      expect(message.photo.fileId).toBe('file123');
      expect(message.photo.width).toBe(800);
      expect(message.photo.height).toBe(600);
      expect(message.photo.isPhoto).toBe(true);
    });

    it('voice should return voice attachment', () => {
      const voice = { fileId: 'voice123', duration: 10 };
      const message = new Message({
        ...validProps,
        type: MessageType.VOICE,
        content: { voice },
      });
      // voice getter now returns an Attachment object
      expect(message.voice).not.toBeNull();
      expect(message.voice.fileId).toBe('voice123');
      expect(message.voice.duration).toBe(10);
      expect(message.voice.isVoice).toBe(true);
    });

    it('callbackData should return callback data', () => {
      const message = new Message({
        ...validProps,
        type: MessageType.CALLBACK,
        content: { callbackData: 'action:123' },
      });
      expect(message.callbackData).toBe('action:123');
    });
  });

  describe('direction helpers', () => {
    it('isIncoming should return true for incoming messages', () => {
      const message = new Message({
        ...validProps,
        direction: MessageDirection.INCOMING,
      });
      expect(message.isIncoming).toBe(true);
      expect(message.isOutgoing).toBe(false);
    });

    it('isOutgoing should return true for outgoing messages', () => {
      const message = new Message({
        ...validProps,
        direction: MessageDirection.OUTGOING,
      });
      expect(message.isOutgoing).toBe(true);
      expect(message.isIncoming).toBe(false);
    });
  });

  describe('isCommand', () => {
    it('should return true for command type', () => {
      const message = new Message({
        ...validProps,
        type: MessageType.COMMAND,
      });
      expect(message.isCommand).toBe(true);
    });

    it('should return false for non-command type', () => {
      const message = new Message({
        ...validProps,
        type: MessageType.TEXT,
      });
      expect(message.isCommand).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const message = new Message(validProps);
      const json = message.toJSON();
      
      expect(json.conversationId).toEqual({ channel: 'telegram', identifier: 'b123_c456' });
      // chatId included for backward compatibility
      expect(json.chatId).toEqual({ channel: 'telegram', identifier: 'b123_c456' });
      expect(json.messageId).toBe('msg789');
      expect(json.type).toBe(MessageType.TEXT);
      expect(json.direction).toBe(MessageDirection.INCOMING);
      // content includes text and legacy fields
      expect(json.content.text).toBe('Hello');
      expect(json.text).toBe('Hello');
      expect(json.attachments).toEqual([]);
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('with', () => {
    it('should create new Message with updated properties', () => {
      const original = new Message(validProps);
      const updated = original.with({ type: MessageType.PHOTO });
      
      expect(updated.type).toBe(MessageType.PHOTO);
      expect(updated.conversationId.equals(original.conversationId)).toBe(true);
      expect(updated).not.toBe(original);
    });
  });

  describe('factory methods', () => {
    const conversationId = new ConversationId('telegram', 'b123_c456');
    const messageId = new MessageId('123');

    it('incomingText should create text message', () => {
      const message = Message.incomingText({
        conversationId,
        messageId,
        text: 'Hello',
      });
      
      expect(message.type).toBe(MessageType.TEXT);
      expect(message.direction).toBe(MessageDirection.INCOMING);
      expect(message.text).toBe('Hello');
    });

    it('incomingPhoto should create photo message', () => {
      const photo = { fileId: 'file123' };
      const message = Message.incomingPhoto({
        conversationId,
        messageId,
        photo,
      });
      
      expect(message.type).toBe(MessageType.PHOTO);
      expect(message.direction).toBe(MessageDirection.INCOMING);
      // photo getter returns Attachment
      expect(message.photo).not.toBeNull();
      expect(message.photo.fileId).toBe('file123');
      expect(message.photo.isPhoto).toBe(true);
    });

    it('incomingPhoto should support caption', () => {
      const photo = { fileId: 'file123' };
      const message = Message.incomingPhoto({
        conversationId,
        messageId,
        photo,
        caption: 'My photo caption',
      });
      
      expect(message.type).toBe(MessageType.PHOTO);
      expect(message.text).toBe('My photo caption');
      expect(message.caption).toBe('My photo caption');
      expect(message.photo.fileId).toBe('file123');
    });

    it('incomingVoice should create voice message', () => {
      const voice = { fileId: 'voice123', duration: 5 };
      const message = Message.incomingVoice({
        conversationId,
        messageId,
        voice,
      });
      
      expect(message.type).toBe(MessageType.VOICE);
      expect(message.direction).toBe(MessageDirection.INCOMING);
      // voice getter returns Attachment
      expect(message.voice).not.toBeNull();
      expect(message.voice.fileId).toBe('voice123');
      expect(message.voice.duration).toBe(5);
      expect(message.voice.isVoice).toBe(true);
    });

    it('incomingCallback should create callback message', () => {
      const message = Message.incomingCallback({
        conversationId,
        messageId,
        callbackData: 'action:value',
      });
      
      expect(message.type).toBe(MessageType.CALLBACK);
      expect(message.direction).toBe(MessageDirection.INCOMING);
      expect(message.callbackData).toBe('action:value');
    });

    it('outgoing should create outgoing message', () => {
      const message = Message.outgoing({
        conversationId,
        messageId,
        content: { text: 'Response' },
      });
      
      expect(message.direction).toBe(MessageDirection.OUTGOING);
      expect(message.type).toBe(MessageType.TEXT);
    });
  });
});

describe('Phase1: MessageType enum', () => {
  it('should have expected values', () => {
    expect(MessageType.TEXT).toBe('text');
    expect(MessageType.PHOTO).toBe('photo');
    expect(MessageType.VOICE).toBe('voice');
    expect(MessageType.CALLBACK).toBe('callback');
    expect(MessageType.COMMAND).toBe('command');
  });
});

describe('Phase1: MessageDirection enum', () => {
  it('should have expected values', () => {
    expect(MessageDirection.INCOMING).toBe('incoming');
    expect(MessageDirection.OUTGOING).toBe('outgoing');
  });
});
