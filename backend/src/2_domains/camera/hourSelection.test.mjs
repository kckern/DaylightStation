/**
 * Hour prioritisation tests.
 *
 * The trap this guards against: `density` records exist for every hour of every
 * day (they are the NVR's bitrate timeline). If they counted as detections,
 * every hour would look interesting and the prioritisation would silently
 * degrade to a plain sequential pass.
 */

import { describe, it, expect } from 'vitest';
import { hoursForTier, pendingHours, segmentWanted, hoursCovered } from './hourSelection.mjs';

const rec = (h, labels, source = 'ha') => ({
  ts: new Date(2026, 6, 17, h, 5).toISOString(),
  endTs: new Date(2026, 6, 17, h, 6).toISOString(),
  labels,
  source,
});

describe('hoursForTier', () => {
  it('selects only hours containing a person, visitor or pet', () => {
    const ledger = [rec(8, ['person']), rec(14, ['vehicle']), rec(20, ['pet'])];
    expect(hoursForTier(ledger, 'person')).toEqual([8, 20]);
  });

  it('selects any real detection for the detections tier', () => {
    const ledger = [rec(8, ['person']), rec(14, ['vehicle'])];
    expect(hoursForTier(ledger, 'detections')).toEqual([8, 14]);
  });

  it('ignores density records, which exist for every hour', () => {
    const ledger = Array.from({ length: 24 }, (_, h) => rec(h, [], 'density'));
    expect(hoursForTier(ledger, 'detections')).toEqual([]);
    expect(hoursForTier(ledger, 'person')).toEqual([]);
  });

  it('returns the whole day for the all tier regardless of ledger', () => {
    expect(hoursForTier([], 'all')).toHaveLength(24);
  });

  it('marks both hours when a detection straddles the boundary', () => {
    const ledger = [{
      ts: new Date(2026, 6, 17, 9, 58).toISOString(),
      endTs: new Date(2026, 6, 17, 10, 3).toISOString(),
      labels: ['person'],
      source: 'ha',
    }];
    expect(hoursForTier(ledger, 'person')).toEqual([9, 10]);
  });
});

describe('pendingHours', () => {
  it('excludes hours a previous pass already completed', () => {
    const ledger = [rec(8, ['person']), rec(9, ['person']), rec(10, ['person'])];
    expect(pendingHours(ledger, 'person', [9])).toEqual([8, 10]);
  });

  it('returns nothing once the tier is fully done', () => {
    const ledger = [rec(8, ['person'])];
    expect(pendingHours(ledger, 'person', [8])).toEqual([]);
  });
});

describe('segmentWanted', () => {
  const seg = (fromH, fromM, toH, toM) => ({
    start: new Date(2026, 6, 17, fromH, fromM),
    end: new Date(2026, 6, 17, toH, toM),
  });

  it('wants a segment overlapping any wanted hour', () => {
    expect(segmentWanted(seg(8, 0, 9, 0), [8])).toBe(true);
  });

  it('skips a segment covering no wanted hour', () => {
    expect(segmentWanted(seg(3, 0, 4, 0), [8, 9])).toBe(false);
  });

  it('keeps a non-clock-aligned segment that straddles into a wanted hour', () => {
    // real NVR segment: 05:59:59 -> 06:35:56
    expect(segmentWanted(seg(5, 59, 6, 35), [6])).toBe(true);
  });
});

describe('hoursCovered', () => {
  it('reports every hour a segment touches', () => {
    expect(hoursCovered({
      start: new Date(2026, 6, 17, 5, 59),
      end: new Date(2026, 6, 17, 6, 35),
    })).toEqual([5, 6]);
  });
});
