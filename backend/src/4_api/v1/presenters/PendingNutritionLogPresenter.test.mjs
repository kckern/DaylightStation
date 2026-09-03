import { describe, it, expect } from 'vitest';
import { presentPendingNutritionLog, deriveNutritionLogSource } from './PendingNutritionLogPresenter.mjs';

const baseLog = {
  id: 'log-1',
  createdAt: '2026-08-30T11:42:00.000Z',
  meal: { date: '2026-08-30', time: 'morning' },
  metadata: {},
  conversationId: '555111222',
  items: [
    { label: 'Apple', calories: 95, protein: 0, uuid: 'i1' },
    { label: 'Peanut Butter', calories: 190, protein: 8, uuid: 'i2' },
  ],
};

describe('deriveNutritionLogSource', () => {
  it('scale-originated logs are tagged scale regardless of conversationId', () => {
    expect(deriveNutritionLogSource({ metadata: { source: 'scale' }, conversationId: '123' })).toBe('scale');
  });

  it('web-originated logs (conversationId "web:<userId>") are tagged web', () => {
    expect(deriveNutritionLogSource({ metadata: { source: 'text' }, conversationId: 'web:kc' })).toBe('web');
  });

  it('everything else (a bare Telegram chat id) is tagged telegram', () => {
    expect(deriveNutritionLogSource({ metadata: { source: 'text' }, conversationId: '555111222' })).toBe('telegram');
  });
});

describe('presentPendingNutritionLog', () => {
  it('projects id, createdAt, source, mealTime, and a slim items list', () => {
    const result = presentPendingNutritionLog(baseLog);
    expect(result).toEqual({
      id: 'log-1',
      createdAt: '2026-08-30T11:42:00.000Z',
      source: 'telegram',
      mealTime: 'morning',
      items: [
        { label: 'Apple', calories: 95 },
        { label: 'Peanut Butter', calories: 190 },
      ],
    });
  });

  it('mealTime is null (never undefined) when the log has no meal.time', () => {
    const result = presentPendingNutritionLog({ ...baseLog, meal: { date: '2026-08-30' } });
    expect(result.mealTime).toBe(null);
  });
});
