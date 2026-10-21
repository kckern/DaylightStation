import { describe, expect, it } from 'vitest';
import { BOARD_CACHE_KEY, readBoardCache, writeBoardCache } from "./boardCache.js";

const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

describe('boardCache', () => {
  it('round-trips a settled snapshot', () => {
    const store = memory();
    writeBoardCache({ studyDay: '2026-09-25', learners: { a: { summary: { total: 1 }, term: { days: [] } } }, rings: { a: { current: 3 } }, earnings: { a: { silver: 4 } }, gold: { a: 3 } }, store);
    expect(readBoardCache(store)).toEqual({
      studyDay: '2026-09-25', learners: { a: { summary: { total: 1 }, term: { days: [] } } }, rings: { a: { current: 3 } }, earnings: { a: { silver: 4 } }, gold: { a: 3 },
    });
  });

  it('keeps stored gold when a write carries none', () => {
    const store = memory();
    writeBoardCache({ studyDay: 'd1', learners: {}, gold: { a: 3 } }, store);
    writeBoardCache({ studyDay: 'd1', learners: {} }, store);
    expect(readBoardCache(store).gold).toEqual({ a: 3 });
  });

  it('keeps stored values for fields still in flight', () => {
    const store = memory();
    writeBoardCache({ studyDay: 'd1', learners: { a: { summary: { total: 1 }, term: { t: 1 } } } }, store);
    writeBoardCache({ studyDay: 'd1', learners: { a: { summary: undefined, term: { t: 2 } } } }, store);
    expect(readBoardCache(store).learners.a).toEqual({ summary: { total: 1 }, term: { t: 2 } });
  });

  it("drops another day's discs but keeps its term grid", () => {
    const store = memory();
    writeBoardCache({ studyDay: 'd1', learners: { a: { summary: { total: 1 }, term: { t: 1 } } } }, store);
    writeBoardCache({ studyDay: 'd2', learners: {} }, store);
    expect(readBoardCache(store).learners.a).toEqual({ term: { t: 1 } });
  });

  it('writes nothing without a study day, and survives junk or a throwing store', () => {
    const store = memory();
    writeBoardCache({ studyDay: null, learners: { a: { summary: {} } } }, store);
    expect(store.map.size).toBe(0);
    store.setItem(BOARD_CACHE_KEY, '{not json');
    expect(readBoardCache(store)).toBeNull();
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(readBoardCache(broken)).toBeNull();
    expect(() => writeBoardCache({ studyDay: 'd1' }, broken)).not.toThrow();
  });

  it('keeps stored earnings when a write carries none (the read still in flight)', () => {
    const store = memory();
    writeBoardCache({ studyDay: 'd1', learners: {}, earnings: { a: { silver: 4 } }, gold: { a: 3 } }, store);
    writeBoardCache({ studyDay: 'd1', learners: {} }, store);
    expect(readBoardCache(store).earnings).toEqual({ a: { silver: 4 } });
  });
});
