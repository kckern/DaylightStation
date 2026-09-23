import { describe, expect, it } from 'vitest';
import { DAY_SCHEMA, STATUS_SCHEMA_V3, emptyDay, emptyStatusV3, migrateStatusV2 } from './statusV3.mjs';

describe('statusV3', () => {
  it('empty shapes', () => {
    expect(emptyStatusV3()).toEqual({ schema: STATUS_SCHEMA_V3, words: {}, decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [] });
    expect(emptyDay('2026-09-22')).toMatchObject({ schema: DAY_SCHEMA, day: '2026-09-22', rounds: [], activeMs: 0, doneAt: null });
    expect(emptyDay('2026-09-22')).toMatchObject({ drills: [], practice: null, practiceRuns: 0, summarySeen: false, capabilities: { microphone: false } });
  });
  it('migrates every v2 state and drops v2 days/sessions', () => {
    const v2 = {
      schema: 'school.word-ladder-status/v1',
      words: {
        a: { state: 'new', step: 0, history: [] },
        b: { state: 'learning', step: 0, history: [] },
        c: { state: 'claimed', step: 0, claimedDay: '2026-09-21', history: [] },
        d: { state: 'known', step: 2, nextCheckDay: '2026-10-01', history: [] },
      },
      paperAttemptsFolded: ['x1'], lastFoldedDay: '2026-09-21', days: { '2026-09-22': {} }, sessions: { s: {} },
    };
    const v3 = migrateStatusV2(v2);
    expect(v3.schema).toBe(STATUS_SCHEMA_V3);
    expect(v3.words.a.state).toBe('new');
    expect(v3.words.b.state).toBe('familiar');
    expect(v3.words.c.state).toBe('claimed');
    expect(v3.words.d).toMatchObject({ state: 'mastered', stage: 3, dueDay: '2026-10-01' });
    expect(v3.paperAttemptsFolded).toEqual(['x1']);
    expect(v3.lastFoldedDay).toBe('2026-09-21');
    expect(v3).not.toHaveProperty('days');
    expect(v3).not.toHaveProperty('sessions');
  });
  it('refuses an unknown schema', () => {
    expect(() => migrateStatusV2({ schema: 'nope', words: {} })).toThrow(/cannot migrate/);
  });
});
