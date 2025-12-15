/**
 * Unit Tests for IInputEvent
 * @module _tests/application/ports/IInputEvent.test
 */

import {
  InputEventType,
  createTextEvent,
  createImageEvent,
  createVoiceEvent,
  createCallbackEvent,
  createCommandEvent,
  createUPCEvent,
  createDocumentEvent,
  isInputEvent,
  assertInputEvent,
  describeEvent,
} from '../../../application/ports/IInputEvent.mjs';

describe('IInputEvent', () => {
  describe('InputEventType enum', () => {
    it('should have all expected event types', () => {
      expect(InputEventType.TEXT).toBe('text');
      expect(InputEventType.IMAGE).toBe('image');
      expect(InputEventType.VOICE).toBe('voice');
      expect(InputEventType.CALLBACK).toBe('callback');
      expect(InputEventType.COMMAND).toBe('command');
      expect(InputEventType.UPC).toBe('upc');
      expect(InputEventType.DOCUMENT).toBe('document');
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(InputEventType)).toBe(true);
    });
  });

  describe('createTextEvent', () => {
    it('should create a valid text event', () => {
      const event = createTextEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        text: 'Hello world',
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.TEXT);
      expect(event.userId).toBe('12345');
      expect(event.conversationId).toBe('telegram:bot_12345');
      expect(event.messageId).toBe('msg1');
      expect(event.channel).toBe('telegram');
      expect(event.payload.text).toBe('Hello world');
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('number');
    });

    it('should use default channel when not specified', () => {
      const event = createTextEvent({
        userId: '12345',
        conversationId: 'test',
        text: 'Hello',
      });

      expect(event.channel).toBe('unknown');
    });
  });

  describe('createImageEvent', () => {
    it('should create a valid image event', () => {
      const event = createImageEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        fileId: 'file123',
        url: 'https://example.com/image.jpg',
        caption: 'Test image',
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.IMAGE);
      expect(event.payload.fileId).toBe('file123');
      expect(event.payload.url).toBe('https://example.com/image.jpg');
      expect(event.payload.caption).toBe('Test image');
    });
  });

  describe('createVoiceEvent', () => {
    it('should create a valid voice event', () => {
      const event = createVoiceEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        fileId: 'voice123',
        duration: 5,
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.VOICE);
      expect(event.payload.fileId).toBe('voice123');
      expect(event.payload.duration).toBe(5);
    });
  });

  describe('createCallbackEvent', () => {
    it('should create a valid callback event', () => {
      const event = createCallbackEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        data: 'accept:uuid123',
        sourceMessageId: 'msg1',
        callbackQueryId: 'query123',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.CALLBACK);
      expect(event.payload.data).toBe('accept:uuid123');
      expect(event.payload.sourceMessageId).toBe('msg1');
      expect(event.payload.callbackQueryId).toBe('query123');
      expect(event.messageId).toBe('query123'); // Uses callbackQueryId
    });
  });

  describe('createCommandEvent', () => {
    it('should create a valid command event', () => {
      const event = createCommandEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        command: 'help',
        args: 'topic',
        rawText: '/help topic',
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.COMMAND);
      expect(event.payload.command).toBe('help');
      expect(event.payload.args).toBe('topic');
      expect(event.payload.rawText).toBe('/help topic');
    });
  });

  describe('createUPCEvent', () => {
    it('should create a valid UPC event', () => {
      const event = createUPCEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        upc: '012345678901',
        rawText: '0-12345-67890-1',
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.UPC);
      expect(event.payload.upc).toBe('012345678901');
      expect(event.payload.rawText).toBe('0-12345-67890-1');
    });
  });

  describe('createDocumentEvent', () => {
    it('should create a valid document event', () => {
      const event = createDocumentEvent({
        userId: '12345',
        conversationId: 'telegram:bot_12345',
        fileId: 'doc123',
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        messageId: 'msg1',
        channel: 'telegram',
      });

      expect(event.type).toBe(InputEventType.DOCUMENT);
      expect(event.payload.fileId).toBe('doc123');
      expect(event.payload.fileName).toBe('report.pdf');
      expect(event.payload.mimeType).toBe('application/pdf');
      expect(event.payload.fileSize).toBe(1024);
    });
  });

  describe('isInputEvent', () => {
    it('should return true for valid events', () => {
      const event = createTextEvent({
        userId: '12345',
        conversationId: 'test',
        text: 'Hello',
        channel: 'telegram',
      });

      expect(isInputEvent(event)).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(isInputEvent(null)).toBe(false);
      expect(isInputEvent(undefined)).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isInputEvent('string')).toBe(false);
      expect(isInputEvent(123)).toBe(false);
    });

    it('should return false for objects missing required fields', () => {
      expect(isInputEvent({ type: 'text' })).toBe(false);
      expect(isInputEvent({ type: 'text', userId: '123' })).toBe(false);
    });

    it('should return false for invalid event types', () => {
      expect(isInputEvent({
        type: 'invalid',
        userId: '123',
        conversationId: 'test',
        channel: 'test',
        timestamp: Date.now(),
        payload: {},
      })).toBe(false);
    });
  });

  describe('assertInputEvent', () => {
    it('should return the event if valid', () => {
      const event = createTextEvent({
        userId: '12345',
        conversationId: 'test',
        text: 'Hello',
        channel: 'telegram',
      });

      expect(assertInputEvent(event)).toBe(event);
    });

    it('should throw for invalid events', () => {
      expect(() => assertInputEvent(null)).toThrow();
      expect(() => assertInputEvent({ type: 'invalid' })).toThrow();
    });
  });

  describe('describeEvent', () => {
    it('should describe text events', () => {
      const event = createTextEvent({
        userId: '12345',
        conversationId: 'test',
        text: 'Hello world',
      });

      const desc = describeEvent(event);
      expect(desc).toContain('12345');
      expect(desc).toContain('Hello world');
    });

    it('should describe image events', () => {
      const event = createImageEvent({
        userId: '12345',
        conversationId: 'test',
        fileId: 'file123',
        caption: 'My photo',
      });

      const desc = describeEvent(event);
      expect(desc).toContain('Image');
      expect(desc).toContain('My photo');
    });

    it('should describe command events', () => {
      const event = createCommandEvent({
        userId: '12345',
        conversationId: 'test',
        command: 'help',
      });

      const desc = describeEvent(event);
      expect(desc).toContain('/help');
    });

    it('should describe callback events', () => {
      const event = createCallbackEvent({
        userId: '12345',
        conversationId: 'test',
        data: 'accept:uuid',
        sourceMessageId: 'msg1',
      });

      const desc = describeEvent(event);
      expect(desc).toContain('Callback');
      expect(desc).toContain('accept:uuid');
    });
  });
});
