/**
 * Identity churn counter — Task 4.8.
 *
 * 480 distinct waitKeys in three minutes was the clearest tell of the
 * 2026-08-16 storm, and nothing counted it. These tests pin the two properties
 * that make the counter worth having: it fires when cardinality explodes, and
 * it fires ONCE — a detector that emits 480 times is a second storm.
 */
import { describe, it, expect } from 'vitest';
import {
  createIdentityChurnCounter,
  CHURN_VALUE_ABSENT,
  CHURN_DISTINCT_THRESHOLD,
  CHURN_WINDOW_MS
} from './identityChurn.js';

const T0 = 1_786_000_000_000;

describe('identityChurn — detection', () => {
  it('stays quiet while identity is stable', () => {
    const counter = createIdentityChurnCounter();
    for (let i = 0; i < 50; i += 1) {
      expect(counter.record({ waitKey: 'plex:1:0', guid: 'plex:1' }, T0 + i * 100)).toBeNull();
    }
    expect(counter.snapshot().distinct).toEqual({ waitKey: 1, guid: 1 });
  });

  it('stays quiet at the threshold and fires just past it', () => {
    const counter = createIdentityChurnCounter();
    for (let i = 0; i < CHURN_DISTINCT_THRESHOLD; i += 1) {
      expect(counter.record({ waitKey: `k${i}`, guid: 'plex:1' }, T0 + i * 100)).toBeNull();
    }
    const report = counter.record({ waitKey: 'k-over', guid: 'plex:1' }, T0 + 2000);
    expect(report).not.toBeNull();
    expect(report.churningDimensions).toEqual(['waitKey']);
    expect(report.distinct.waitKey).toBe(CHURN_DISTINCT_THRESHOLD + 1);
    // The guid held still, so the report says the NONCE moved, not the content.
    expect(report.distinct.guid).toBe(1);
  });

  it('counts a churning guid too — the half a per-item bucket would have missed', () => {
    // On 2026-08-16 the guid changed on every pass. Bucketing per guid would
    // have produced hundreds of buckets holding one value each and never fired.
    const counter = createIdentityChurnCounter();
    let report = null;
    for (let i = 0; i < 20 && !report; i += 1) {
      report = counter.record({ waitKey: `plex:${i}:0`, guid: `plex:${i}` }, T0 + i * 100);
    }
    expect(report).not.toBeNull();
    expect(report.churningDimensions).toEqual(['waitKey', 'guid']);
    expect(report.samples.guid.length).toBeGreaterThan(0);
    expect(report.observations).toBeGreaterThan(CHURN_DISTINCT_THRESHOLD);
  });
});

describe('identityChurn — one line per episode', () => {
  it('emits once for a burst of 480, not 480 times', () => {
    const counter = createIdentityChurnCounter();
    const reports = [];
    for (let i = 0; i < 480; i += 1) {
      const r = counter.record({ waitKey: `k${i}`, guid: 'plex:1' }, T0 + i * 100);
      if (r) reports.push(r);
    }
    expect(reports).toHaveLength(1);
    expect(counter.snapshot().episodeOpen).toBe(true);
    // The peak is still readable even though only one line went out.
    expect(counter.snapshot().episodePeak).toBeGreaterThan(CHURN_DISTINCT_THRESHOLD);
  });

  it('re-arms once the window drains, so a second burst gets its own line', () => {
    const counter = createIdentityChurnCounter();
    let first = null;
    for (let i = 0; i < 20 && !first; i += 1) {
      first = counter.record({ waitKey: `a${i}`, guid: 'plex:1' }, T0 + i * 100);
    }
    expect(first).not.toBeNull();

    // A quiet observation a full window later drops every earlier value.
    const later = T0 + CHURN_WINDOW_MS + 10_000;
    expect(counter.record({ waitKey: 'calm', guid: 'plex:1' }, later)).toBeNull();
    expect(counter.snapshot().episodeOpen).toBe(false);

    let second = null;
    for (let i = 0; i < 20 && !second; i += 1) {
      second = counter.record({ waitKey: `b${i}`, guid: 'plex:1' }, later + i * 100);
    }
    expect(second).not.toBeNull();
  });

  it('does not count a repeated value again', () => {
    const counter = createIdentityChurnCounter();
    for (let i = 0; i < 100; i += 1) {
      counter.record({ waitKey: 'same', guid: 'plex:1' }, T0 + i * 100);
    }
    expect(counter.snapshot().distinct.waitKey).toBe(1);
    expect(counter.snapshot().episodeOpen).toBe(false);
  });
});

describe('identityChurn — absence', () => {
  it('names a missing dimension instead of letting it pass as a value', () => {
    const counter = createIdentityChurnCounter();
    counter.record({ waitKey: 'k1' }, T0);
    let report = null;
    for (let i = 0; i < 20 && !report; i += 1) {
      report = counter.record({ waitKey: `k${i}` }, T0 + i * 100);
    }
    expect(report.samples.guid).toEqual([CHURN_VALUE_ABSENT]);
    // One absent guid is one identity, not many: absence must not itself churn.
    expect(report.distinct.guid).toBe(1);
  });
});
