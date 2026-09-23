import { describe, expect, it } from 'vitest';
import { emptyDay, emptyStatusV3 } from '#domains/school/wordLadder/index.mjs';
import { ShadowWordLadderStores } from './ShadowWordLadderStores.mjs';

const real = {
  status: emptyStatusV3(), writes: 0,
  readStatus() { return structuredClone(this.status); },
  readDay(u, p, d) { return emptyDay(d); },
  transact() { this.writes += 1; },
  readTuning() { return { schema: 'school.word-ladder-tuning/v1', values: { 'round.size': 6 }, lastChanged: {}, lastTunedDay: '2026-09-21', history: [] }; },
  writeTuning() { this.writes += 1; },
};

describe('ShadowWordLadderStores', () => {
  it('snapshots, mutates only memory, never writes the real store', () => {
    const shadows = new ShadowWordLadderStores({ real, now: () => 0 });
    const token = shadows.create('test-learner', 'korean-vocab', '2026-09-22');
    const store = shadows.forToken(token);
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, decksSeen: ['d'] }, dayFile }));
    expect(store.readStatus('test-learner', 'korean-vocab').decksSeen).toEqual(['d']);
    expect(real.writes).toBe(0);
    expect(real.status.decksSeen).toEqual([]);
  });
  it('applies a seed and evicts after the TTL', () => {
    let t = 0;
    const shadows = new ShadowWordLadderStores({ real, now: () => t, ttlMs: 10 });
    const token = shadows.create('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, lastFoldedDay: 'seeded' }, dayFile }));
    expect(shadows.forToken(token).readStatus().lastFoldedDay).toBe('seeded');
    t = 11;
    expect(() => shadows.forToken(token)).toThrow(/test sitting/);
  });
  it('reads tuning from the real store and can never write it', () => {
    const shadows = new ShadowWordLadderStores({ real, now: () => 0 });
    const store = shadows.forToken(shadows.create('test-learner', 'korean-vocab', '2026-09-22'));
    expect(store.readTuning('test-learner', 'korean-vocab').values).toEqual({ 'round.size': 6 });
    expect(store.writeTuning).toBeUndefined();
    expect(real.writes).toBe(0);
  });
  it('peek: a seeded, read-only snapshot that is never kept (the start card)', () => {
    const shadows = new ShadowWordLadderStores({ real, now: () => 0, max: 1 });
    const kept = shadows.create('test-learner', 'korean-vocab', '2026-09-22');
    const store = shadows.peek('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, lastFoldedDay: 'seeded' }, dayFile }));
    expect(store.readStatus().lastFoldedDay).toBe('seeded');
    expect(store.readDay('test-learner', 'korean-vocab', '2026-09-22').day).toBe('2026-09-22');
    expect(store.transact).toBeUndefined();
    // A peek takes no slot: the one kept shadow (max 1) survives it.
    expect(() => shadows.forToken(kept)).not.toThrow();
    expect(real.writes).toBe(0);
  });
});
