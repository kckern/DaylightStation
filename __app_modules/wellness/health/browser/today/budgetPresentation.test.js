import { expect, it } from 'vitest';
import { budgetPresentation } from './budgetPresentation.js';

it('does not invent an energy balance when maintenance is unknown', () => {
  expect(budgetPresentation({ food: 2033, exercise: 168, range: { floor: 1200, top: 1600 } })).toMatchObject({
    tone: 'over', position: { value: 265, text: 'over goal range' }, balance: 'Estimated calorie balance unavailable',
  });
});
it('does not turn a finished under-floor day green', () => {
  expect(budgetPresentation({ food: 800, exercise: 168, maintenance: 2000, range: { floor: 1200, top: 1600 } }, { finished: true })).toMatchObject({
    tone: 'under-finished', position: { value: 400, text: 'under goal range' },
  });
});
it('extends only the right edge with exercise and preserves the configured start', () => {
  expect(budgetPresentation({ food: 1250, exercise: 600, maintenance: 2000, range: { floor: 1200, top: 1600 } })).toMatchObject({
    tone: 'in-range', position: { value: null, text: 'Within goal range' }, balance: '1,350 kcal estimated deficit',
  });
});
