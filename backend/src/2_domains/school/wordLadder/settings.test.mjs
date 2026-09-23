import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings } from './settings.mjs';

describe('resolveSettings', () => {
  it('defaults', () => { expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS); });
  it('merges and clamps', () => {
    const s = resolveSettings({ settings: { round: { size: 99 }, session: { capMinutes: 20 } }, bounds: { 'round.size': [3, 7] } });
    expect(s.round.size).toBe(7);
    expect(s.session.capMinutes).toBe(20);
    expect(s.batch.newPerDay).toBe(4);
  });
});
