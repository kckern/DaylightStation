import { describe, expect, it } from 'vitest';
import { isValidTemplateComponent } from './mealTemplate.mjs';

describe('isValidTemplateComponent', () => {
  it('requires a trimmed name and allows an unknown weight', () => {
    expect(isValidTemplateComponent({ name: 'Milk', grams: '' })).toBe(true);
    expect(isValidTemplateComponent({ name: 'Milk' })).toBe(true);
    expect(isValidTemplateComponent({ name: '  ', grams: 50 })).toBe(false);
    expect(isValidTemplateComponent({ name: 'Milk', grams: 0 })).toBe(false);
    expect(isValidTemplateComponent({ name: 'Milk', grams: -1 })).toBe(false);
    expect(isValidTemplateComponent({ name: 'Milk', grams: 75 })).toBe(true);
  });
});
