import { describe, it, expect } from 'vitest';
import { NutritionReceiptRenderer } from './NutritionReceiptRenderer.mjs';
import { nutritionReceipt } from '#domains/nutrition/services/nutritionReceipt.mjs';

const renderer = new NutritionReceiptRenderer();
const log = { id: 'meal', status: 'accepted', meal: { date: '2026-08-20', time: 'midday' }, metadata: {} };
function render(items, entry = log, options) {
  return renderer.render(nutritionReceipt(entry, items.map((row, i) => ({ uuid: `food${i}`, logId: 'meal', ...row }))), options);
}

describe('NutritionReceiptRenderer — established Telegram receipt contract', () => {
  it('preserves the August 20 meal exactly, with one header and colored compact portions', () => {
    const items = [
      ['Grilled Chicken Breast', 180, 'yellow'], ['Quinoa', 145, 'yellow'],
      ['Roasted Sweet Potato', 145, 'green'], ['Steamed Broccoli', 145, 'green'],
      ['Mixed Greens (Spinach & Arugula)', 35, 'green'], ['Dried Blueberries', 20, 'yellow'],
      ['Olive Oil (Dressing)', 15, 'orange'],
    ].map(([name, grams, color]) => ({ name, grams, color }));
    expect(render(items).text).toBe('✅ Thu, 20 Aug 2026 midday\n\n🟡 Grilled Chicken Breast 180g\n🟡 Quinoa 145g\n🟢 Roasted Sweet Potato 145g\n🟢 Steamed Broccoli 145g\n🟢 Mixed Greens (Spinach & Arugula) 35g\n🟡 Dried Blueberries 20g\n🟠 Olive Oil (Dressing) 15g');
  });
  it('keeps the burrito heading and exact saved quantities without a sixth consumption', () => {
    const items = [{ uuid: 'group', kind: 'group', name: 'Breakfast Burrito', calories: 0 },
      ...[['Flour Tortilla', 167, 290, 'yellow'], ['Scrambled Eggs', 112, 170, 'yellow'],
        ['Diced Ham', 60, 90, 'orange'], ['Mixed Vegetables', 30, 8, 'green'], ['Shredded Cheese', 28, 110, 'orange']]
        .map(([name, grams, calories, color], i) => ({ uuid: `child${i}`, parentId: 'group', name, grams, calories, color }))]
      .map(row => ({ ...row, logId: 'meal', date: '2026-09-05', mealTime: 'evening' }));
    const model = nutritionReceipt(log, items);
    expect(model.count).toBe(5); expect(model.calories).toBe(668);
    expect(renderer.render(model).text).toBe('✅ Sat, 5 Sept 2026 evening\n\nBreakfast Burrito\n  🟡 Flour Tortilla 167g\n  🟡 Scrambled Eggs 112g\n  🟠 Diced Ham 60g\n  🟢 Mixed Vegetables 30g\n  🟠 Shredded Cheese 28g');
  });
  it('never substitutes old parser quantities for current ledger values', () => {
    const original = { ...log, items: [{ name: 'Old food', grams: 1 }] };
    expect(render([{ name: 'Corrected food', grams: 458, color: 'yellow' }], original).text).toContain('Corrected food 458g');
    expect(render([], original)).toEqual({ text: '↩️ Removed from food log', choices: [] });
  });
  it('does not turn unknown mass into grams or unknown portions into zero', () => {
    expect(render([{ name: 'Yogurt', grams: null, amount: 170, unit: 'ml' }]).text).toContain('Yogurt 170ml');
    expect(render([{ name: 'Yogurt', grams: null, amount: 1, unit: 'serving' }]).text).toContain('Yogurt 1 serving');
    expect(render([{ name: 'Food', grams: null }]).text).toContain('Food portion unknown');
  });
  it('uses saved day/meal for split receipts, not rendering wall clock', () => {
    const text = render([{ name: 'A', grams: 3, date: '2026-08-20', mealTime: 'midday' },
      { name: 'B', grams: 4, date: '2026-08-21', mealTime: 'evening' }]).text;
    expect(text).toContain('Thu, 20 Aug 2026 midday'); expect(text).toContain('Fri, 21 Aug 2026 evening');
  });
  it('keeps text, controls and photo-caption limits deterministic', () => {
    const items = Array.from({ length: 170 }, (_, i) => ({ name: `Food ${i}`, grams: i + 1 }));
    const receipt = render(items, log, { limit: 1000 });
    expect(receipt.text.length).toBeLessThanOrEqual(1000);
    expect(receipt.text).toMatch(/Full entry in Health$/);
    expect(receipt.choices[0].map(button => JSON.parse(button.callback_data).cmd)).toEqual(['x', 'r']);
    expect(render(items.map(row => ({ ...row, settled: true, review: { state: 'stabilized' } })), log, { limit: 1000 })).toEqual(receipt);
  });
});
