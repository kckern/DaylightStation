/**
 * Tests for NutriBot domain entities and schemas
 * @group nutribot
 */

import { FoodItem } from '../../nutribot/domain/FoodItem.mjs';
import { NutriLog } from '../../nutribot/domain/NutriLog.mjs';
import {
  NoomColors,
  LogStatuses,
  MealTimes,
  validateNoomColor,
  validateLogStatus,
  validateMealTime,
  validateFoodItem,
  validateNutriLog,
  getMealTimeFromHour,
  getMealLabel,
} from '../../nutribot/domain/schemas.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('NutriBot: Schemas', () => {
  describe('NoomColors', () => {
    it('should contain valid colors', () => {
      expect(NoomColors).toContain('green');
      expect(NoomColors).toContain('yellow');
      expect(NoomColors).toContain('orange');
      expect(NoomColors).toHaveLength(3);
    });
  });

  describe('validateNoomColor', () => {
    it('should accept valid colors', () => {
      expect(validateNoomColor('green').valid).toBe(true);
      expect(validateNoomColor('yellow').valid).toBe(true);
      expect(validateNoomColor('orange').valid).toBe(true);
    });

    it('should reject invalid colors', () => {
      expect(validateNoomColor('red').valid).toBe(false);
      expect(validateNoomColor('blue').valid).toBe(false);
    });
  });

  describe('LogStatuses', () => {
    it('should contain valid statuses', () => {
      expect(LogStatuses).toContain('pending');
      expect(LogStatuses).toContain('accepted');
      expect(LogStatuses).toContain('rejected');
      expect(LogStatuses).toContain('deleted');
    });
  });

  describe('MealTimes', () => {
    it('should contain valid meal times', () => {
      expect(MealTimes).toContain('morning');
      expect(MealTimes).toContain('afternoon');
      expect(MealTimes).toContain('evening');
      expect(MealTimes).toContain('night');
    });
  });

  describe('getMealTimeFromHour', () => {
    it('should return morning for 5-11', () => {
      expect(getMealTimeFromHour(5)).toBe('morning');
      expect(getMealTimeFromHour(8)).toBe('morning');
      expect(getMealTimeFromHour(11)).toBe('morning');
    });

    it('should return afternoon for 12-16', () => {
      expect(getMealTimeFromHour(12)).toBe('afternoon');
      expect(getMealTimeFromHour(14)).toBe('afternoon');
      expect(getMealTimeFromHour(16)).toBe('afternoon');
    });

    it('should return evening for 17-20', () => {
      expect(getMealTimeFromHour(17)).toBe('evening');
      expect(getMealTimeFromHour(19)).toBe('evening');
      expect(getMealTimeFromHour(20)).toBe('evening');
    });

    it('should return night for 21-4', () => {
      expect(getMealTimeFromHour(21)).toBe('night');
      expect(getMealTimeFromHour(23)).toBe('night');
      expect(getMealTimeFromHour(2)).toBe('night');
    });
  });

  describe('getMealLabel', () => {
    it('should return display labels', () => {
      expect(getMealLabel('morning')).toBe('Breakfast');
      expect(getMealLabel('afternoon')).toBe('Lunch');
      expect(getMealLabel('evening')).toBe('Dinner');
      expect(getMealLabel('night')).toBe('Late Night');
    });
  });
});

describe('NutriBot: FoodItem', () => {
  const validProps = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    label: 'Oatmeal',
    icon: 'oatmeal',
    grams: 100,
    unit: 'g',
    amount: 100,
    color: 'green',
  };

  describe('constructor', () => {
    it('should create FoodItem with valid props', () => {
      const item = new FoodItem(validProps);
      expect(item.id).toBe(validProps.id);
      expect(item.label).toBe('Oatmeal');
      expect(item.color).toBe('green');
    });

    it('should be immutable', () => {
      const item = new FoodItem(validProps);
      expect(Object.isFrozen(item)).toBe(true);
    });

    it('should throw for invalid props', () => {
      expect(() => new FoodItem({ ...validProps, color: 'purple' }))
        .toThrow(ValidationError);
    });

    it('should throw for missing required fields', () => {
      expect(() => new FoodItem({ ...validProps, label: '' }))
        .toThrow(ValidationError);
    });
  });

  describe('computed properties', () => {
    it('isGreen should return true for green items', () => {
      const item = new FoodItem(validProps);
      expect(item.isGreen).toBe(true);
      expect(item.isYellow).toBe(false);
      expect(item.isOrange).toBe(false);
    });

    it('displayAmount should format correctly', () => {
      const item = new FoodItem(validProps);
      expect(item.displayAmount).toBe('100g');
    });
  });

  describe('with', () => {
    it('should create copy with updates', () => {
      const item = new FoodItem(validProps);
      const updated = item.with({ grams: 200, amount: 200 });
      
      expect(updated.grams).toBe(200);
      expect(updated.label).toBe('Oatmeal'); // Unchanged
      expect(updated).not.toBe(item);
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const item = new FoodItem(validProps);
      const json = item.toJSON();
      
      expect(json).toEqual(validProps);
    });
  });

  describe('factory methods', () => {
    it('create should auto-generate ID', () => {
      const item = FoodItem.create({
        label: 'Apple',
        icon: 'apple',
        grams: 150,
        unit: 'g',
        amount: 150,
        color: 'green',
      });
      
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.label).toBe('Apple');
    });

    it('fromLegacy should convert legacy format', () => {
      const legacy = {
        item: 'Grilled Salmon',
        icon: 'salmon',
        unit: 'g',
        amount: 240,
        noom_color: 'yellow',
      };
      
      const item = FoodItem.fromLegacy(legacy);
      
      expect(item.label).toBe('Grilled Salmon');
      expect(item.icon).toBe('salmon');
      expect(item.color).toBe('yellow');
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});

describe('NutriBot: NutriLog', () => {
  const validProps = {
    id: '337c9ec4-3afd-48f2-9960-1c4662b0f1f5',
    userId: 'kirk',
    conversationId: 'telegram:b6898194425_c575596036',
    status: 'pending',
    text: 'Healthy breakfast with oatmeal',
    meal: {
      date: '2025-06-01',
      time: 'morning',
    },
    items: [
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        label: 'Oatmeal',
        icon: 'oatmeal',
        grams: 100,
        unit: 'g',
        amount: 100,
        color: 'green',
      },
      {
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        label: 'Greek Yogurt',
        icon: 'yogurt',
        grams: 200,
        unit: 'g',
        amount: 200,
        color: 'yellow',
      },
    ],
    questions: [],
    nutrition: {},
    metadata: { messageId: '3801', source: 'telegram' },
    createdAt: '2025-06-01T08:30:00.000Z',
    updatedAt: '2025-06-01T08:30:00.000Z',
    acceptedAt: null,
  };

  describe('constructor', () => {
    it('should create NutriLog with valid props', () => {
      const log = new NutriLog(validProps);
      
      expect(log.id).toBe(validProps.id);
      expect(log.userId).toBe('kirk');
      expect(log.status).toBe('pending');
      expect(log.items).toHaveLength(2);
    });

    it('should convert items to FoodItem instances', () => {
      const log = new NutriLog(validProps);
      expect(log.items[0]).toBeInstanceOf(FoodItem);
    });

    it('should be immutable', () => {
      const log = new NutriLog(validProps);
      expect(Object.isFrozen(log)).toBe(true);
    });

    it('should throw for invalid props', () => {
      expect(() => new NutriLog({ ...validProps, status: 'invalid' }))
        .toThrow(ValidationError);
    });
  });

  describe('status checks', () => {
    it('isPending should be true for pending status', () => {
      const log = new NutriLog(validProps);
      expect(log.isPending).toBe(true);
      expect(log.isAccepted).toBe(false);
    });

    it('isAccepted should be true for accepted status', () => {
      const log = new NutriLog({ ...validProps, status: 'accepted' });
      expect(log.isAccepted).toBe(true);
      expect(log.isPending).toBe(false);
    });
  });

  describe('computed properties', () => {
    it('itemCount should return number of items', () => {
      const log = new NutriLog(validProps);
      expect(log.itemCount).toBe(2);
    });

    it('totalGrams should sum all item grams', () => {
      const log = new NutriLog(validProps);
      expect(log.totalGrams).toBe(300); // 100 + 200
    });

    it('colorCounts should count items by color', () => {
      const log = new NutriLog(validProps);
      expect(log.colorCounts).toEqual({ green: 1, yellow: 1, orange: 0 });
    });

    it('gramsByColor should sum grams by color', () => {
      const log = new NutriLog(validProps);
      expect(log.gramsByColor).toEqual({ green: 100, yellow: 200, orange: 0 });
    });
  });

  describe('status transitions', () => {
    it('accept should change status to accepted', () => {
      const log = new NutriLog(validProps);
      const accepted = log.accept();
      
      expect(accepted.isAccepted).toBe(true);
      expect(accepted.acceptedAt).toBeTruthy();
      expect(accepted).not.toBe(log);
    });

    it('accept should throw if not pending', () => {
      const log = new NutriLog({ ...validProps, status: 'accepted' });
      expect(() => log.accept()).toThrow(ValidationError);
    });

    it('reject should change status to rejected', () => {
      const log = new NutriLog(validProps);
      const rejected = log.reject();
      
      expect(rejected.isRejected).toBe(true);
    });

    it('delete should change status to deleted', () => {
      const log = new NutriLog(validProps);
      const deleted = log.delete();
      
      expect(deleted.isDeleted).toBe(true);
    });
  });

  describe('item management', () => {
    it('addItem should add new item', () => {
      const log = new NutriLog(validProps);
      const newItem = FoodItem.create({
        label: 'Coffee',
        icon: 'coffee',
        grams: 500,
        unit: 'ml',
        amount: 500,
        color: 'green',
      });
      
      const updated = log.addItem(newItem);
      
      expect(updated.itemCount).toBe(3);
      expect(updated.items[2].label).toBe('Coffee');
    });

    it('removeItem should remove item by ID', () => {
      const log = new NutriLog(validProps);
      const updated = log.removeItem('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      
      expect(updated.itemCount).toBe(1);
      expect(updated.items[0].label).toBe('Greek Yogurt');
    });

    it('updateItem should modify item', () => {
      const log = new NutriLog(validProps);
      const updated = log.updateItem('a1b2c3d4-e5f6-7890-abcd-ef1234567890', { grams: 150 });
      
      expect(updated.items[0].grams).toBe(150);
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const log = new NutriLog(validProps);
      const json = log.toJSON();
      
      expect(json.id).toBe(validProps.id);
      expect(json.items).toHaveLength(2);
      expect(json.items[0].label).toBe('Oatmeal');
    });
  });

  describe('toNutriListItems', () => {
    it('should create denormalized list items', () => {
      const log = new NutriLog(validProps);
      const listItems = log.toNutriListItems();
      
      expect(listItems).toHaveLength(2);
      expect(listItems[0]).toEqual({
        logId: validProps.id,
        label: 'Oatmeal',
        grams: 100,
        color: 'green',
        status: 'pending',
        createdAt: validProps.createdAt,
        acceptedAt: null,
      });
    });
  });

  describe('factory methods', () => {
    it('create should create pending log with auto-ID', () => {
      const log = NutriLog.create({
        userId: 'kirk',
        conversationId: 'telegram:test',
        text: 'Test meal',
        items: [
          { label: 'Apple', icon: 'apple', grams: 150, unit: 'g', amount: 150, color: 'green' }
        ],
      });
      
      expect(log.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(log.status).toBe('pending');
      expect(log.itemCount).toBe(1);
      expect(log.items[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('create should auto-detect meal time', () => {
      const log = NutriLog.create({
        userId: 'kirk',
        conversationId: 'telegram:test',
        text: 'Test',
      });
      
      expect(log.meal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['morning', 'afternoon', 'evening', 'night']).toContain(log.meal.time);
    });

    it('fromLegacy should convert legacy format', () => {
      const legacy = {
        uuid: '337c9ec4-3afd-48f2-9960-1c4662b0f1f5',
        chat_id: 'b6898194425_u575596036',
        message_id: 3801,
        food_data: {
          date: '2025-06-01',
          time: 'morning',
          food: [
            { item: 'Oatmeal', icon: 'oatmeal', unit: 'g', amount: 100, noom_color: 'green' },
          ],
          questions: [],
          nutrition: {},
          text: 'Healthy breakfast',
        },
        status: 'accepted',
      };
      
      const log = NutriLog.fromLegacy(legacy, 'kirk', 'telegram:b6898194425_c575596036');
      
      expect(log.id).toBe(legacy.uuid);
      expect(log.userId).toBe('kirk');
      expect(log.status).toBe('accepted');
      expect(log.items[0].label).toBe('Oatmeal');
      expect(log.metadata.source).toBe('migration');
    });
  });
});
