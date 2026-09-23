import { describe, expect, it } from 'vitest';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { SCENARIOS, seedScenario } from './scenarios.mjs';

const snap = () => ({ status: { ...emptyStatusV3(), decksSeen: ['d'] }, dayFile: emptyDay('2026-09-22') });
const opts = { deckWords: ['a', 'b'], day: '2026-09-22' };

describe('seedScenario', () => {
  it('today keeps the snapshot; fresh empties it', () => {
    expect(seedScenario('today', snap(), opts).status.decksSeen).toEqual(['d']);
    expect(seedScenario('fresh', snap(), opts).status.decksSeen).toEqual([]);
  });
  it('due makes every deck word a due stage-1 master', () => {
    expect(seedScenario('due', snap(), opts).status.words.a).toMatchObject({ state: 'mastered', stage: 1, dueDay: '2026-09-22' });
  });
  it('round-end makes them familiar from yesterday', () => {
    expect(seedScenario('round-end', snap(), opts).status.words.b).toMatchObject({ state: 'familiar', introducedDay: '2026-09-21' });
  });
  it('done marks the day complete; unknown names throw', () => {
    expect(seedScenario('done', snap(), opts).dayFile.doneAt).toBe('2026-09-22');
    expect(() => seedScenario('nope', snap(), opts)).toThrow(/scenario/);
  });
  it('tricky makes every deck word familiar from 3 days ago and the first one tricky since yesterday', () => {
    const { status, dayFile } = seedScenario('tricky', snap(), opts);
    expect(status.words.a).toMatchObject({ state: 'familiar', introducedDay: '2026-09-19', tricky: true, trickySince: '2026-09-21', missStreak: 2 });
    expect(status.words.b).toMatchObject({ state: 'familiar', introducedDay: '2026-09-19', tricky: false });
    expect(dayFile).toEqual(emptyDay('2026-09-22'));
  });
  it('typos makes every deck word familiar from yesterday (a carry round with typed quiz items)', () => {
    const { status } = seedScenario('typos', snap(), opts);
    expect(Object.keys(status.words)).toEqual(['a', 'b']);
    expect(status.words.a).toMatchObject({ state: 'familiar', introducedDay: '2026-09-21', tricky: false });
  });
  it('lists every seed', () => {
    expect(SCENARIOS).toEqual(expect.arrayContaining(['tricky', 'typos']));
  });
});
