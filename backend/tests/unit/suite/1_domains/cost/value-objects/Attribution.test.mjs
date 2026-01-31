import { describe, it, expect } from 'vitest';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('Attribution', () => {
  describe('constructor', () => {
    it('should create Attribution with all fields', () => {
      const attr = new Attribution({
        householdId: 'default',
        userId: 'teen',
        feature: 'assistant',
        resource: 'office_plug',
        tags: { room: 'office', device_type: 'computer' }
      });

      expect(attr.householdId).toBe('default');
      expect(attr.userId).toBe('teen');
      expect(attr.feature).toBe('assistant');
      expect(attr.resource).toBe('office_plug');
      expect(attr.tags.get('room')).toBe('office');
      expect(attr.tags.get('device_type')).toBe('computer');
    });

    it('should create minimal Attribution with only householdId', () => {
      const attr = new Attribution({ householdId: 'default' });

      expect(attr.householdId).toBe('default');
      expect(attr.userId).toBeNull();
      expect(attr.feature).toBeNull();
      expect(attr.resource).toBeNull();
      expect(attr.tags).toBeInstanceOf(Map);
      expect(attr.tags.size).toBe(0);
    });

    it('should throw ValidationError if householdId is missing', () => {
      expect(() => new Attribution({})).toThrow(ValidationError);
      expect(() => new Attribution({})).toThrow('householdId is required');
    });

    it('should throw ValidationError if householdId is null', () => {
      expect(() => new Attribution({ householdId: null })).toThrow(ValidationError);
    });

    it('should throw ValidationError if householdId is undefined', () => {
      expect(() => new Attribution({ householdId: undefined })).toThrow(ValidationError);
    });

    it('should throw ValidationError if householdId is empty string', () => {
      expect(() => new Attribution({ householdId: '' })).toThrow(ValidationError);
    });

    it('should include error code for missing householdId', () => {
      try {
        new Attribution({});
      } catch (error) {
        expect(error.code).toBe('MISSING_HOUSEHOLD_ID');
      }
    });

    it('should convert tags object to Map', () => {
      const attr = new Attribution({
        householdId: 'default',
        tags: { key1: 'value1', key2: 'value2' }
      });

      expect(attr.tags).toBeInstanceOf(Map);
      expect(attr.tags.get('key1')).toBe('value1');
      expect(attr.tags.get('key2')).toBe('value2');
    });

    it('should accept Map as tags', () => {
      const tagsMap = new Map([['key1', 'value1']]);
      const attr = new Attribution({
        householdId: 'default',
        tags: tagsMap
      });

      expect(attr.tags.get('key1')).toBe('value1');
    });

    it('should default tags to empty Map when not provided', () => {
      const attr = new Attribution({ householdId: 'default' });
      expect(attr.tags).toBeInstanceOf(Map);
      expect(attr.tags.size).toBe(0);
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const attr = new Attribution({ householdId: 'default' });
      expect(Object.isFrozen(attr)).toBe(true);
    });

    it('should not allow modification of householdId', () => {
      const attr = new Attribution({ householdId: 'default' });
      expect(() => {
        attr.householdId = 'other';
      }).toThrow();
    });

    it('should have frozen tags Map', () => {
      const attr = new Attribution({
        householdId: 'default',
        tags: { key: 'value' }
      });
      // Frozen Maps throw on set()
      expect(() => {
        attr.tags.set('newKey', 'newValue');
      }).toThrow();
    });
  });

  describe('getters', () => {
    it('should return householdId via getter', () => {
      const attr = new Attribution({ householdId: 'main' });
      expect(attr.householdId).toBe('main');
    });

    it('should return userId via getter', () => {
      const attr = new Attribution({ householdId: 'default', userId: 'john' });
      expect(attr.userId).toBe('john');
    });

    it('should return feature via getter', () => {
      const attr = new Attribution({ householdId: 'default', feature: 'lights' });
      expect(attr.feature).toBe('lights');
    });

    it('should return resource via getter', () => {
      const attr = new Attribution({ householdId: 'default', resource: 'living_room_lamp' });
      expect(attr.resource).toBe('living_room_lamp');
    });

    it('should return tags via getter', () => {
      const attr = new Attribution({
        householdId: 'default',
        tags: { location: 'kitchen' }
      });
      expect(attr.tags.get('location')).toBe('kitchen');
    });
  });

  describe('toJSON', () => {
    it('should return object with all fields when populated', () => {
      const attr = new Attribution({
        householdId: 'default',
        userId: 'teen',
        feature: 'assistant',
        resource: 'office_plug',
        tags: { room: 'office' }
      });

      const json = attr.toJSON();
      expect(json).toEqual({
        householdId: 'default',
        userId: 'teen',
        feature: 'assistant',
        resource: 'office_plug',
        tags: { room: 'office' }
      });
    });

    it('should always include householdId', () => {
      const attr = new Attribution({ householdId: 'default' });
      const json = attr.toJSON();
      expect(json.householdId).toBe('default');
    });

    it('should omit userId when null', () => {
      const attr = new Attribution({ householdId: 'default' });
      const json = attr.toJSON();
      expect(json).not.toHaveProperty('userId');
    });

    it('should omit feature when null', () => {
      const attr = new Attribution({ householdId: 'default' });
      const json = attr.toJSON();
      expect(json).not.toHaveProperty('feature');
    });

    it('should omit resource when null', () => {
      const attr = new Attribution({ householdId: 'default' });
      const json = attr.toJSON();
      expect(json).not.toHaveProperty('resource');
    });

    it('should omit tags when empty', () => {
      const attr = new Attribution({ householdId: 'default' });
      const json = attr.toJSON();
      expect(json).not.toHaveProperty('tags');
    });

    it('should convert tags Map to plain object', () => {
      const attr = new Attribution({
        householdId: 'default',
        tags: { key1: 'value1', key2: 'value2' }
      });

      const json = attr.toJSON();
      expect(json.tags).toEqual({ key1: 'value1', key2: 'value2' });
      expect(json.tags).not.toBeInstanceOf(Map);
    });

    it('should include only non-null optional fields', () => {
      const attr = new Attribution({
        householdId: 'default',
        userId: 'admin',
        feature: null,
        resource: 'server'
      });

      const json = attr.toJSON();
      expect(json).toEqual({
        householdId: 'default',
        userId: 'admin',
        resource: 'server'
      });
    });
  });

  describe('fromJSON', () => {
    it('should create Attribution from JSON object', () => {
      const attr = Attribution.fromJSON({
        householdId: 'default',
        userId: 'teen',
        feature: 'assistant',
        resource: 'office_plug',
        tags: { room: 'office' }
      });

      expect(attr.householdId).toBe('default');
      expect(attr.userId).toBe('teen');
      expect(attr.feature).toBe('assistant');
      expect(attr.resource).toBe('office_plug');
      expect(attr.tags.get('room')).toBe('office');
    });

    it('should create minimal Attribution from JSON', () => {
      const attr = Attribution.fromJSON({ householdId: 'default' });

      expect(attr.householdId).toBe('default');
      expect(attr.userId).toBeNull();
      expect(attr.feature).toBeNull();
      expect(attr.resource).toBeNull();
      expect(attr.tags.size).toBe(0);
    });

    it('should handle tags as plain object', () => {
      const attr = Attribution.fromJSON({
        householdId: 'default',
        tags: { key1: 'value1', key2: 'value2' }
      });

      expect(attr.tags.get('key1')).toBe('value1');
      expect(attr.tags.get('key2')).toBe('value2');
    });

    it('should throw ValidationError for missing householdId', () => {
      expect(() => Attribution.fromJSON({})).toThrow(ValidationError);
    });

    it('should throw ValidationError for null data', () => {
      expect(() => Attribution.fromJSON(null)).toThrow(ValidationError);
    });

    it('should throw ValidationError for undefined data', () => {
      expect(() => Attribution.fromJSON(undefined)).toThrow(ValidationError);
    });
  });

  describe('round-trip serialization', () => {
    it('should preserve data through toJSON/fromJSON cycle', () => {
      const original = new Attribution({
        householdId: 'default',
        userId: 'teen',
        feature: 'assistant',
        resource: 'office_plug',
        tags: { room: 'office', device_type: 'computer' }
      });

      const json = original.toJSON();
      const restored = Attribution.fromJSON(json);

      expect(restored.householdId).toBe(original.householdId);
      expect(restored.userId).toBe(original.userId);
      expect(restored.feature).toBe(original.feature);
      expect(restored.resource).toBe(original.resource);
      expect(restored.tags.get('room')).toBe(original.tags.get('room'));
      expect(restored.tags.get('device_type')).toBe(original.tags.get('device_type'));
    });

    it('should preserve minimal data through round-trip', () => {
      const original = new Attribution({ householdId: 'minimal' });

      const json = original.toJSON();
      const restored = Attribution.fromJSON(json);

      expect(restored.householdId).toBe('minimal');
      expect(restored.userId).toBeNull();
      expect(restored.feature).toBeNull();
      expect(restored.resource).toBeNull();
      expect(restored.tags.size).toBe(0);
    });
  });
});
