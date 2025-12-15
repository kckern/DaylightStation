/**
 * Mock Report Renderer Tests
 * @module cli/__tests__/MockReportRenderer.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MockReportRenderer } from '../mocks/MockReportRenderer.mjs';

describe('MockReportRenderer', () => {
  let renderer;

  beforeEach(() => {
    renderer = new MockReportRenderer({ textMode: true });
  });

  describe('renderDailyReport', () => {
    it('should render a text report with all sections', async () => {
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 1500, protein: 100, carbs: 150, fat: 50 },
        goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        items: [
          { name: 'Chicken Salad', calories: 350, color: 'green' },
          { name: 'Apple', calories: 95, color: 'green' },
        ],
      });

      expect(typeof report).toBe('string');
      expect(report).toContain('DAILY NUTRITION REPORT');
      expect(report).toContain('2024-12-14');
      expect(report).toContain('Calories');
      expect(report).toContain('Protein');
      expect(report).toContain('Carbs');
      expect(report).toContain('Fat');
      expect(report).toContain('Chicken Salad');
      expect(report).toContain('Apple');
    });

    it('should show progress percentages', async () => {
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 1000, protein: 75, carbs: 100, fat: 33 },
        goals: { calories: 2000, protein: 150, carbs: 200, fat: 66 },
        items: [],
      });

      expect(report).toContain('50%'); // 1000/2000 = 50%
    });

    it('should handle empty items array', async () => {
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        items: [],
      });

      expect(report).toContain('DAILY NUTRITION REPORT');
      expect(report).not.toContain('FOOD LOG');
    });

    it('should show color indicators for items', async () => {
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 500, protein: 50, carbs: 50, fat: 20 },
        goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        items: [
          { name: 'Green Food', calories: 100, color: 'green' },
          { name: 'Yellow Food', calories: 200, color: 'yellow' },
          { name: 'Orange Food', calories: 200, color: 'orange' },
        ],
      });

      expect(report).toContain('🟢'); // green indicator
      expect(report).toContain('🟡'); // yellow indicator
      expect(report).toContain('🟠'); // orange indicator
    });

    it('should handle missing totals gracefully', async () => {
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        items: [],
      });

      expect(report).toContain('DAILY NUTRITION REPORT');
      expect(report).toContain('0%');
    });
  });

  describe('renderFoodCard', () => {
    it('should render a text food card', async () => {
      const card = await renderer.renderFoodCard({
        name: 'Quest Bar',
        brand: 'Quest Nutrition',
        calories: 190,
        protein: 21,
        carbs: 21,
        fat: 8,
      });

      expect(typeof card).toBe('string');
      expect(card).toContain('Quest Bar');
      expect(card).toContain('Quest Nutrition');
      expect(card).toContain('Calories: 190');
      expect(card).toContain('Protein:  21g');
      expect(card).toContain('Carbs:    21g');
      expect(card).toContain('Fat:      8g');
    });

    it('should show servings if provided', async () => {
      const card = await renderer.renderFoodCard({
        name: 'Coca-Cola',
        calories: 140,
        protein: 0,
        carbs: 39,
        fat: 0,
        servings: [
          { name: '1 can (12 fl oz)' },
          { name: '1 bottle (20 fl oz)' },
        ],
      });

      expect(card).toContain('Servings:');
      expect(card).toContain('1 can (12 fl oz)');
      expect(card).toContain('1 bottle (20 fl oz)');
    });

    it('should handle missing fields gracefully', async () => {
      const card = await renderer.renderFoodCard({
        name: 'Unknown Item',
      });

      expect(card).toContain('Unknown Item');
      expect(card).toContain('Calories: 0');
    });
  });

  describe('image mode', () => {
    it('should return a Buffer in image mode', async () => {
      const imageRenderer = new MockReportRenderer({ textMode: false });
      
      const result = await imageRenderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 1500, protein: 100, carbs: 150, fat: 50 },
        goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        items: [],
      });

      expect(Buffer.isBuffer(result)).toBe(true);
      // Check PNG signature
      expect(result[0]).toBe(0x89);
      expect(result[1]).toBe(0x50);
      expect(result[2]).toBe(0x4E);
      expect(result[3]).toBe(0x47);
    });

    it('should return Buffer for food card in image mode', async () => {
      const imageRenderer = new MockReportRenderer({ textMode: false });
      
      const result = await imageRenderer.renderFoodCard({
        name: 'Test Item',
        calories: 100,
      });

      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });
});
