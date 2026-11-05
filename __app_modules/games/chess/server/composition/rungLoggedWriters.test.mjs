import { describe, expect, it } from 'vitest';
import { createChessRungLoggedWriters } from './runtime.mjs';

function harness({ household = {}, files = {}, rungLog } = {}) {
  const store = new Map(Object.entries(files));
  const notes = [];
  const writers = createChessRungLoggedWriters({
    configService: { getHouseholdAppConfig: () => household },
    dataService: { user: {
      read: (p, u) => store.get(`${u}:${p}`) ?? null,
      write: (p, v, u) => { store.set(`${u}:${p}`, v); return true; },
    } },
    rungLog: rungLog ?? { note: (c) => notes.push(c) },
  });
  return { writers, notes, store };
}

describe('chess rung-logged writers', () => {
  it('notes the match ladder before and after each write', () => {
    const { writers, notes, store } = harness({ files: { 'kidB:apps/chess/ladder': { unlocked_through: 4, results: [] } } });
    expect(writers.writeProgress('kidB', { unlocked_through: 5, results: [] })).toBe(true);
    expect(store.get('kidB:apps/chess/ladder').unlocked_through).toBe(5);
    expect(notes).toEqual([{ userId: 'kidB', game: 'chess', ladder: 'match', from: 4, to: 5 }]);
  });

  it('reads the addressing rung from the user layer, else the household', () => {
    const { writers, notes } = harness({ household: { addressing: { ladder: { unlocked_through: 2 } } } });
    writers.writeUserConfig('kidB', { addressing: { ladder: { unlocked_through: 3 } } });
    writers.writeUserConfig('kidB', { seen_intro: true, addressing: { ladder: { unlocked_through: 3 } } });
    expect(notes).toEqual([
      { userId: 'kidB', game: 'chess', ladder: 'addressing', from: 2, to: 3 },
      { userId: 'kidB', game: 'chess', ladder: 'addressing', from: 3, to: 3 },
    ]);
  });

  it('a throwing log never fails the write', () => {
    const { writers, store } = harness({ rungLog: { note: () => { throw new Error('boom'); } } });
    expect(writers.writeProgress('kidB', { unlocked_through: 1, results: [] })).toBe(true);
    expect(store.get('kidB:apps/chess/ladder').unlocked_through).toBe(1);
  });
});
