import { describe, it, expect, vi } from 'vitest';
import { DayInstructionReader, addDaysISO, dayName } from './DayInstructionReader.mjs';

const gateway = answers => ({ isConfigured: () => true, evaluate: vi.fn(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, answers[id]])) })) });
const pick = choice => ({ type: 'choice', choice, confidence: 0.9, probabilities: {} });
const yes = probability => ({ type: 'yesNo', probability });
const reader = g => new DayInstructionReader({ decisionGateway: g });

const validRead = { intent: pick('move'), target: pick('latest'), fromMeal: pick('morning'), toMeal: pick('same'), toDay: pick('2026-11-17'), compound: yes(0.1) };
const readInput = { text: 'move that to yesterday', date: '2026-11-18', today: '2026-11-18', foods: ['Eggs'], latest: ['Eggs'] };
const twoFoods = [{ id: 'e', name: 'Eggs' }, { id: 'c', name: 'Cookie' }];

const badChoices = extra => [
  ['missing', undefined],
  ['null', null],
  ['a yes/no answer', yes(0.9)],
  ['no choice field', { type: 'choice' }],
  ['an inherited key', pick('toString')],
  ['an array holding a valid key', { type: 'choice', choice: extra.valid ? [extra.valid] : [] }],
  ...extra.offList.map(value => [`off-list ${value}`, pick(value)]),
];
const badYesNos = [
  ['missing', undefined],
  ['null', null],
  ['a choice answer', pick('yes')],
  ['no probability', { type: 'yesNo' }],
  ['NaN', yes(Number.NaN)],
  ['Infinity', yes(Number.POSITIVE_INFINITY)],
  ['a numeric string', yes('0.9')],
  ['above 1', yes(1.5)],
  ['below 0', yes(-0.1)],
];
const malformed = [
  ...badChoices({ valid: 'move', offList: ['delete'] }).map(([label, bad]) => ['intent', label, bad]),
  ...badChoices({ valid: 'latest', offList: ['everything', 'unclear'] }).map(([label, bad]) => ['target', label, bad]),
  ...badChoices({ valid: 'morning', offList: ['same'] }).map(([label, bad]) => ['fromMeal', label, bad]),
  ...badChoices({ valid: 'same', offList: ['none'] }).map(([label, bad]) => ['toMeal', label, bad]),
  ...badChoices({ valid: 'same', offList: ['2026-11-18', '2026-11-11'] }).map(([label, bad]) => ['toDay', label, bad]),
  ...badYesNos.map(([label, bad]) => ['compound', label, bad]),
];

const backticked = text => [...String(text).matchAll(/`([^`]+)`/g)].map(match => match[1]);
const namesIn = questions => Object.values(questions).flatMap(question => [
  ...backticked(question.instructions),
  ...Object.values(question.options || {}).flatMap(backticked),
]);

describe('DayInstructionReader', () => {
  it('offers the last seven days except the viewed one, and returns typed answers', async () => {
    const g = gateway(validRead);
    const plan = await reader(g).read(readInput);
    expect(plan).toEqual({ intent: 'move', target: 'latest', fromMeal: 'morning', toMeal: 'same', toDay: '2026-11-17', compound: false });
    const options = Object.keys(g.evaluate.mock.calls[0][1].toDay.options);
    expect(options).toContain('2026-11-12');
    expect(options).not.toContain('2026-11-18');
    expect(options).not.toContain('2026-11-11');
    expect(options).toEqual(expect.arrayContaining(['same', 'older']));
  });
  it('offers the viewed day as a destination when the latest capture is on another day', async () => {
    const g = gateway(validRead);
    await reader(g).read({ ...readInput, latestDate: '2026-11-17' });
    const options = Object.keys(g.evaluate.mock.calls[0][1].toDay.options);
    expect(options).toEqual(expect.arrayContaining(['2026-11-18', '2026-11-17']));
    expect(options).not.toContain('2026-11-11');
  });
  it('accepts the viewed day as an answer only when it was offered', async () => {
    const answers = { ...validRead, toDay: pick('2026-11-18') };
    expect((await reader(gateway(answers)).read({ ...readInput, latestDate: '2026-11-17' })).toDay).toBe('2026-11-18');
    await expect(reader(gateway(answers)).read({ ...readInput, latestDate: '2026-11-18' })).rejects.toThrow('Invalid decision answer: toDay');
  });
  it('offers a viewed day older than the seven days when the latest capture is elsewhere', async () => {
    const g = gateway(validRead);
    await reader(g).read({ ...readInput, date: '2026-11-01', latestDate: '2026-11-17' });
    expect(g.evaluate.mock.calls[0][1].toDay.options['2026-11-01']).toContain('Sun, Nov 1');
  });
  it('reads a day with no foods, showing the latest capture from elsewhere', async () => {
    const g = gateway(validRead);
    await reader(g).read({ ...readInput, foods: [], latest: ['Pizza'], latestDate: '2026-11-17' });
    expect(g.evaluate.mock.calls[0][0]).toMatchObject({ foods_on_this_day: [], latest_capture: ['Pizza'] });
  });
  it('lets the model decline the request and say no meal was named, but always pick a target', async () => {
    const g = gateway({ ...validRead, intent: pick('other'), target: pick('named'), fromMeal: pick('none') });
    const plan = await reader(g).read(readInput);
    expect(plan).toMatchObject({ intent: 'other', target: 'named', fromMeal: 'none' });
    const questions = g.evaluate.mock.calls[0][1];
    expect(Object.keys(questions.target.options).sort()).toEqual(['latest', 'meal', 'named', 'whole_day']);
    expect(Object.keys(questions.fromMeal.options).sort()).toEqual(['afternoon', 'evening', 'morning', 'night', 'none']);
    expect(Object.keys(questions.toMeal.options)).toContain('same');
  });
  it('asks every question about what was said', async () => {
    const g = gateway(validRead);
    await reader(g).read(readInput);
    for (const question of Object.values(g.evaluate.mock.calls[0][1])) expect(question.instructions).toContain('`said`');
  });
  it('counts several eaten foods, or several foods sent to one place, as one request', async () => {
    const g = gateway(validRead);
    await reader(g).read(readInput);
    expect(g.evaluate.mock.calls[0][1].compound.instructions).toBe('Does `said` ask for two or more separate changes, such as moving one food and correcting another, moving foods to different places, or logging a new food and also changing a logged one? Reporting several foods eaten, even at different meals, is one request, and so is sending several foods to the same place.');
  });
  it.each(malformed)('rejects a malformed %s answer, naming the question: %s', async (id, _label, bad) => {
    await expect(reader(gateway({ ...validRead, [id]: bad })).read(readInput)).rejects.toThrow(new Error(`Invalid decision answer: ${id}`));
  });
  it('treats exactly 0.5 as yes', async () => {
    const plan = await reader(gateway({ ...validRead, compound: yes(0.5) })).read(readInput);
    expect(plan.compound).toBe(true);
    const ids = await reader(gateway({ food_0: yes(0.5), food_1: yes(0.49) })).matchFoods({ text: 'the eggs', foods: twoFoods });
    expect(ids).toEqual(['e']);
  });

  it('matches foods one yes/no at a time', async () => {
    const g = gateway({ food_0: yes(0.9), food_1: yes(0.2) });
    const ids = await reader(g).matchFoods({ text: 'the drinks', foods: [{ id: 'tea', name: 'Tea' }, { id: 'egg', name: 'Egg' }] });
    expect(ids).toEqual(['tea']);
  });
  it.each(badYesNos)('rejects a food match answer that is %s, even after a clear yes', async (_label, bad) => {
    await expect(reader(gateway({ food_0: yes(0.9), food_1: bad })).matchFoods({ text: 'the eggs', foods: twoFoods })).rejects.toThrow(new Error('Invalid decision answer: food_1'));
  });

  it('assigns meals, leaving a food alone when no meal was said or implied', async () => {
    const g = gateway({ meal_0: pick('morning'), meal_1: pick('unsaid') });
    const placed = await reader(g).assignMeals({ text: 'eggs at breakfast and a cookie', foods: twoFoods });
    expect(placed).toEqual({ e: 'morning' });
  });
  it.each(badChoices({ valid: 'morning', offList: ['same', 'none'] }))('rejects a meal answer that is %s, even after a valid one', async (_label, bad) => {
    await expect(reader(gateway({ meal_0: pick('morning'), meal_1: bad })).assignMeals({ text: 'eggs and a cookie', foods: twoFoods })).rejects.toThrow(new Error('Invalid decision answer: meal_1'));
  });

  it('makes no gateway call when there are no foods', async () => {
    const g = gateway({});
    await expect(reader(g).matchFoods({ text: 'the drinks', foods: [] })).resolves.toEqual([]);
    await expect(reader(g).assignMeals({ text: 'at lunch', foods: [] })).resolves.toEqual({});
    expect(g.evaluate).not.toHaveBeenCalled();
  });

  it('only refers to names present in the state it sends, and uses all of them', async () => {
    const answers = { ...validRead, food_0: yes(0.9), food_1: yes(0.2), meal_0: pick('morning'), meal_1: pick('unsaid') };
    const g = gateway(answers);
    await reader(g).read(readInput);
    await reader(g).matchFoods({ text: 'the eggs', foods: twoFoods });
    await reader(g).assignMeals({ text: 'eggs at breakfast', foods: twoFoods });
    expect(g.evaluate).toHaveBeenCalledTimes(3);
    for (const [state, questions] of g.evaluate.mock.calls) {
      expect([...new Set(namesIn(questions))].sort()).toEqual(Object.keys(state).sort());
    }
  });

  it('is unavailable when the gateway is not configured', () => {
    expect(reader({ isConfigured: () => false }).available).toBe(false);
  });
  it('names days the way the app does', () => {
    expect(dayName('2026-11-18', '2026-11-18')).toBe('Today');
    expect(dayName('2026-11-17', '2026-11-18')).toBe('Yesterday');
    expect(dayName('2026-11-10', '2026-11-18')).toBe('Tue, Nov 10');
  });
  it.each([
    ['2026-11-01', -1, '2026-10-31'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-03-01', -1, '2028-02-29'],
  ])('moves %s by %i days to %s', (iso, days, expected) => {
    expect(addDaysISO(iso, days)).toBe(expected);
  });
});
