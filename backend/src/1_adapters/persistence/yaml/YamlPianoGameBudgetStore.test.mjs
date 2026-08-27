import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlPianoGameBudgetStore } from './YamlPianoGameBudgetStore.mjs';
import { emptyDay, applyOpen } from '#domains/piano/gameBudget.mjs';

let root; let store;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'piano-budget-'));
  store = new YamlPianoGameBudgetStore({ historyRoot: root, logger: { warn: () => {}, error: () => {} } });
});

describe('YamlPianoGameBudgetStore', () => {
  it('a missing day file loads as an empty day (a fresh day, not an error)', () => {
    const day = store.loadDay('2026-08-27');
    expect(day).toEqual(emptyDay('2026-08-27'));
  });

  it('round-trips a day record through save and load', () => {
    const { day } = applyOpen(emptyDay('2026-08-27'), {
      sessionId: 's1', learnerId: 'kid_a', deviceId: 'kiosk',
      at: '2026-08-27T20:00:00.000Z', staleAfterSeconds: 900,
    });
    store.saveDay(day);
    expect(store.loadDay('2026-08-27')).toEqual(day);
    // Written where the design says: household/history/piano-games/{date}.yml
    expect(readFileSync(path.join(root, '2026-08-27.yml'), 'utf8')).toContain('piano.game-budget-day/v1');
  });

  it('a CORRUPT day file throws rather than resetting balances to zero (D16)', () => {
    writeFileSync(path.join(root, '2026-08-27.yml'), '{{{ not yaml');
    expect(() => store.loadDay('2026-08-27')).toThrow(/corrupt/i);
  });

  it('a wrong-schema file throws for the same reason', () => {
    writeFileSync(path.join(root, '2026-08-27.yml'), 'schema: something-else/v9\n');
    expect(() => store.loadDay('2026-08-27')).toThrow(/schema/i);
  });
});
