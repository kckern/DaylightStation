import { describe, test, expect } from 'vitest';
import {
  assessDuration,
  IMPLAUSIBLE_MAX_SEC,
  IMPLAUSIBLE_FLOOR_SEC,
} from './repairMediaDuration.mjs';

const span = (playedSeconds, durationSeconds) => ({
  start: 1_700_000_000_000,
  end: 1_700_000_000_000 + playedSeconds * 1000,
  durationSeconds,
});

describe('assessDuration', () => {
  test('flags a 32-minute workout stored as 2 seconds', () => {
    // The shape of every affected event: durationSeconds is the real length
    // divided by 1000 (see 2026-09-01-media-duration-divided-twice.md).
    const { corrupt, playedSeconds } = assessDuration(span(1941, 2));
    expect(corrupt).toBe(true);
    expect(playedSeconds).toBe(1941);
  });

  test('leaves a plausible duration alone', () => {
    expect(assessDuration(span(614, 621)).corrupt).toBe(false);
  });

  test('leaves a partially-played item alone — a long nominal is not corrupt', () => {
    // A 90-minute item abandoned after 6 minutes: played << nominal, the
    // opposite of the defect.
    expect(assessDuration(span(360, 5400)).corrupt).toBe(false);
  });

  test('tolerates a duration rounded slightly below the played span', () => {
    expect(assessDuration(span(1210, 1200)).corrupt).toBe(false);
  });

  test('does not mistake a LOOPED short video for corruption', () => {
    // A 349s stretch video played on repeat for ~17 minutes. The old ratio rule
    // flagged it, then "repaired" 349 to 349, so the pass never converged.
    expect(assessDuration(span(1050, 349)).corrupt).toBe(false);
  });

  test('spares short clips, where a small absolute error looks like a big ratio', () => {
    const justUnderFloor = IMPLAUSIBLE_FLOOR_SEC - 1;
    expect(assessDuration(span(justUnderFloor, 1)).corrupt).toBe(false);
  });

  test('fires just under the sub-minute boundary and not at it', () => {
    expect(assessDuration(span(1200, IMPLAUSIBLE_MAX_SEC)).corrupt).toBe(false);
    expect(assessDuration(span(1200, IMPLAUSIBLE_MAX_SEC - 1)).corrupt).toBe(true);
  });

  test('still catches a partially-played item whose nominal was mangled', () => {
    // Mario Kart: 16,725s nominal stored as 17, played only 347s. A ratio rule
    // misses this one; the absolute rule does not.
    expect(assessDuration(span(347, 17)).corrupt).toBe(true);
  });

  test('cannot judge an event with no played span', () => {
    // "Unverifiable" is not "corrupt" — the summary path's synthetic events
    // carry no start/end and must not be rewritten.
    const { corrupt, playedSeconds } = assessDuration({ durationSeconds: 2 });
    expect(corrupt).toBe(false);
    expect(playedSeconds).toBeNull();
  });

  test('cannot judge an event with no duration at all', () => {
    expect(assessDuration(span(1941, undefined)).corrupt).toBe(false);
  });

  test('reads the snake_case spelling too', () => {
    const data = span(1941, undefined);
    data.duration_seconds = 2;
    expect(assessDuration(data).corrupt).toBe(true);
  });

  test('survives absent and malformed input', () => {
    expect(assessDuration(null).corrupt).toBe(false);
    expect(assessDuration({}).corrupt).toBe(false);
    expect(assessDuration({ start: 5, end: 1, durationSeconds: 2 }).corrupt).toBe(false);
  });
});
