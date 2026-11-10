import { describe, expect, it, vi } from 'vitest';
import { PianoRungLog } from './PianoRungLog.mjs';

function memoryStore() {
  const entries = new Map();
  return {
    entries,
    list: (id) => entries.get(id) ?? [],
    append: (id, entry) => { entries.set(id, [...(entries.get(id) ?? []), entry]); return true; },
  };
}
const clock = () => new Date('2026-11-04T18:00:00Z');

describe('PianoRungLog', () => {
  it('appends a dated entry for a raise only', () => {
    const store = memoryStore();
    const log = new PianoRungLog({ store, clock });
    expect(log.note({ userId: 'kidB', game: 'checkers', ladder: 'match', from: 3, to: 4 }))
      .toEqual({ at: '2026-11-04T18:00:00.000Z', game: 'checkers', ladder: 'match', from: 3, to: 4 });
    expect(log.note({ userId: 'kidB', game: 'checkers', ladder: 'match', from: 4, to: 4 })).toBeNull();
    expect(log.note({ userId: 'kidB', game: 'checkers', ladder: 'addressing', from: 4, to: 3 })).toBeNull();
    expect(log.note({ userId: 'kidB', game: 'checkers', ladder: 'bogus', from: 1, to: 2 })).toBeNull();
    expect(log.list('kidB')).toHaveLength(1);
  });

  it('reads a missing from as the ladder floor (chess match 0, else 1)', () => {
    const store = memoryStore();
    const log = new PianoRungLog({ store, clock });
    expect(log.note({ userId: 'a', game: 'chess', ladder: 'match', from: null, to: 0 })).toBeNull();
    expect(log.note({ userId: 'a', game: 'chess', ladder: 'match', from: null, to: 1 })).toMatchObject({ from: 0, to: 1 });
    expect(log.note({ userId: 'a', game: 'checkers', ladder: 'match', from: undefined, to: 1 })).toBeNull();
    expect(log.note({ userId: 'a', game: 'checkers', ladder: 'addressing', from: null, to: 2 })).toMatchObject({ from: 1, to: 2 });
  });

  it('never throws when the store fails, and says so', () => {
    const logger = { warn: vi.fn(), info: vi.fn() };
    const log = new PianoRungLog({ store: { list: () => [], append: () => { throw new Error('EACCES'); } }, logger, clock });
    expect(log.note({ userId: 'kidB', game: 'checkers', ladder: 'match', from: 1, to: 2 })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('piano.rung-log.append-failed', expect.objectContaining({ error: 'EACCES' }));
    const refused = new PianoRungLog({ store: { list: () => [], append: () => false }, logger, clock });
    expect(refused.note({ userId: 'kidB', game: 'checkers', ladder: 'match', from: 1, to: 2 })).toBeNull();
  });
});
