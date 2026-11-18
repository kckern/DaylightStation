import { describe, it, expect, vi } from 'vitest';
import { DayInstructionReader, dayName } from './DayInstructionReader.mjs';

const gateway = answers => ({ isConfigured: () => true, evaluate: vi.fn(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, answers[id]])) })) });
const pick = choice => ({ type: 'choice', choice, confidence: 0.9, probabilities: {} });

describe('DayInstructionReader', () => {
  it('offers the last seven days except the viewed one, and returns typed answers', async () => {
    const g = gateway({ intent: pick('move'), target: pick('latest'), fromMeal: pick('morning'), toMeal: pick('same'), toDay: pick('2026-11-17'), compound: { type: 'yesNo', probability: 0.1 } });
    const plan = await new DayInstructionReader({ decisionGateway: g }).read({ text: 'move that to yesterday', date: '2026-11-18', today: '2026-11-18', foods: ['Eggs'], latest: ['Eggs'] });
    expect(plan).toEqual({ intent: 'move', target: 'latest', fromMeal: 'morning', toMeal: 'same', toDay: '2026-11-17', compound: false });
    const options = Object.keys(g.evaluate.mock.calls[0][1].toDay.options);
    expect(options).toContain('2026-11-12');
    expect(options).not.toContain('2026-11-18');
    expect(options).toEqual(expect.arrayContaining(['same', 'older']));
  });
  it('matches foods one yes/no at a time', async () => {
    const g = gateway({ food_0: { type: 'yesNo', probability: 0.9 }, food_1: { type: 'yesNo', probability: 0.2 } });
    const ids = await new DayInstructionReader({ decisionGateway: g }).matchFoods({ text: 'the drinks', foods: [{ id: 'tea', name: 'Tea' }, { id: 'egg', name: 'Egg' }] });
    expect(ids).toEqual(['tea']);
  });
  it('assigns meals, leaving a food alone when no meal was said or implied', async () => {
    const g = gateway({ meal_0: pick('morning'), meal_1: pick('unsaid') });
    const placed = await new DayInstructionReader({ decisionGateway: g }).assignMeals({ text: 'eggs at breakfast and a cookie', foods: [{ id: 'e', name: 'Eggs' }, { id: 'c', name: 'Cookie' }] });
    expect(placed).toEqual({ e: 'morning' });
  });
  it('is unavailable when the gateway is not configured', () => {
    expect(new DayInstructionReader({ decisionGateway: { isConfigured: () => false } }).available).toBe(false);
  });
  it('names days the way the app does', () => {
    expect(dayName('2026-11-18', '2026-11-18')).toBe('Today');
    expect(dayName('2026-11-17', '2026-11-18')).toBe('Yesterday');
    expect(dayName('2026-11-10', '2026-11-18')).toBe('Tue, Nov 10');
  });
});
