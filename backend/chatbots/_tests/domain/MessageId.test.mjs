/**
 * Tests for MessageId value object
 * @group Phase1
 */

import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase1: MessageId', () => {
  describe('constructor', () => {
    it('should create MessageId from string', () => {
      const messageId = new MessageId('12345');
      expect(messageId.value).toBe('12345');
    });

    it('should create MessageId from number', () => {
      const messageId = new MessageId(12345);
      expect(messageId.value).toBe('12345');
    });

    it('should throw ValidationError for null', () => {
      expect(() => new MessageId(null)).toThrow(ValidationError);
    });

    it('should throw ValidationError for undefined', () => {
      expect(() => new MessageId(undefined)).toThrow(ValidationError);
    });

    it('should throw ValidationError for empty string', () => {
      expect(() => new MessageId('')).toThrow(ValidationError);
      expect(() => new MessageId('  ')).toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const messageId = new MessageId('12345');
      expect(Object.isFrozen(messageId)).toBe(true);
    });
  });

  describe('value property', () => {
    it('should return string value', () => {
      const messageId = new MessageId(12345);
      expect(typeof messageId.value).toBe('string');
      expect(messageId.value).toBe('12345');
    });
  });

  describe('toNumber', () => {
    it('should return numeric value', () => {
      const messageId = new MessageId('12345');
      expect(messageId.toNumber()).toBe(12345);
    });

    it('should return NaN for non-numeric', () => {
      const messageId = new MessageId('abc');
      expect(messageId.toNumber()).toBeNaN();
    });
  });

  describe('toString', () => {
    it('should return string value', () => {
      const messageId = new MessageId(12345);
      expect(messageId.toString()).toBe('12345');
    });
  });

  describe('toJSON', () => {
    it('should serialize to string', () => {
      const messageId = new MessageId(12345);
      expect(messageId.toJSON()).toBe('12345');
    });

    it('should work with JSON.stringify', () => {
      const obj = { messageId: new MessageId(12345) };
      expect(JSON.stringify(obj)).toBe('{"messageId":"12345"}');
    });
  });

  describe('equals', () => {
    it('should return true for equal MessageIds', () => {
      const id1 = new MessageId('12345');
      const id2 = new MessageId(12345); // Number normalized to string
      expect(id1.equals(id2)).toBe(true);
    });

    it('should return false for different values', () => {
      const id1 = new MessageId('12345');
      const id2 = new MessageId('67890');
      expect(id1.equals(id2)).toBe(false);
    });

    it('should return false for non-MessageId', () => {
      const id = new MessageId('12345');
      expect(id.equals('12345')).toBe(false);
      expect(id.equals({ value: '12345' })).toBe(false);
    });
  });

  describe('from', () => {
    it('should return same MessageId instance', () => {
      const original = new MessageId('12345');
      const result = MessageId.from(original);
      expect(result).toBe(original);
    });

    it('should create from string', () => {
      const messageId = MessageId.from('12345');
      expect(messageId.value).toBe('12345');
    });

    it('should create from number', () => {
      const messageId = MessageId.from(12345);
      expect(messageId.value).toBe('12345');
    });
  });

  describe('isValid', () => {
    it('should return true for valid values', () => {
      expect(MessageId.isValid('12345')).toBe(true);
      expect(MessageId.isValid(12345)).toBe(true);
      expect(MessageId.isValid('abc')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(MessageId.isValid(null)).toBe(false);
      expect(MessageId.isValid(undefined)).toBe(false);
      expect(MessageId.isValid('')).toBe(false);
    });
  });
});
