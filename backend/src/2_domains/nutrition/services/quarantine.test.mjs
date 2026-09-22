import { describe, it, expect } from 'vitest';
import { NutriLog } from '../entities/NutriLog.mjs';
import { isQuarantined, withoutQuarantined, quarantineMarker, QUARANTINE_NO_CALORIES } from './quarantine.mjs';

describe('capture quarantine', () => {
  const quarantined = { status: 'pending', metadata: { quarantined: true, quarantineReason: QUARANTINE_NO_CALORIES } };
  it('is a pending log carrying the marker', () => {
    expect(isQuarantined(quarantined)).toBe(true);
    expect(isQuarantined({ status: 'pending', metadata: {} })).toBe(false);
    expect(isQuarantined({ ...quarantined, status: 'accepted' })).toBe(false);
    expect(isQuarantined(null)).toBe(false);
  });
  it('filters quarantined logs out of a pending list', () => {
    const other = { status: 'pending', metadata: {} };
    expect(withoutQuarantined([quarantined, other])).toEqual([other]);
  });
  it('builds the marker', () => {
    expect(quarantineMarker()).toEqual({ quarantined: true, quarantineReason: 'no-calories' });
  });
  it('survives the NutriLog metadata whitelist, which is what reaches YAML', () => {
    const log = NutriLog.create({ id: 'aB3dE5gH7j', userId: 'u', conversationId: 'c', timestamp: new Date('2026-09-22T12:00:00Z'),
      items: [{ id: 'kL9mN1pQ3r', color: 'yellow', uuid: '00000000-0000-4000-a000-000000000001', label: 'Magazine', calories: null, grams: null, unit: 'serving', amount: 1 }],
      metadata: { source: 'upc', ...quarantineMarker() } });
    expect(isQuarantined(log)).toBe(true);
    // `with` rebuilds through the validating constructor, as every save does.
    expect(isQuarantined(log.with({ meal: log.meal }, new Date('2026-09-22T12:01:00Z')))).toBe(true);
  });
});
