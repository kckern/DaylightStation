// tests/isolated/domain/weekly-review/learnerWinsPolicy.test.mjs
import { describe, it, expect } from 'vitest';
import {
  studyWindowInstants,
  sumEarned,
  hasWeekWins,
} from '../../../../__app_modules/personal/weekly-review/server/domain/learnerWinsPolicy.mjs';

const TZ = 'America/Los_Angeles';
const DATES = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];

describe('studyWindowInstants', () => {
  it('runs from 04:00 local on the first date to 04:00 local the day after the last', () => {
    const { startMs, endMs } = studyWindowInstants(DATES, TZ);
    // PST is UTC-8 in November.
    expect(new Date(startMs).toISOString()).toBe('2026-11-15T12:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });

  it('follows the offset across a DST change', () => {
    // 2026-03-08 is the spring-forward day in Los Angeles.
    const { startMs, endMs } = studyWindowInstants(['2026-03-07', '2026-03-08'], TZ);
    expect(new Date(startMs).toISOString()).toBe('2026-03-07T12:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-03-09T11:00:00.000Z');
  });

  it('is null for an empty window', () => {
    expect(studyWindowInstants([], TZ)).toBeNull();
  });
});

describe('sumEarned', () => {
  const window = studyWindowInstants(DATES, TZ);
  const row = (o) => ({ kind: 'earn', currency: 'silver', delta: 10, action: 'payout:piano-daily', source: 'payout', ref: null, at: '2026-11-18T20:00:00.000Z', ...o });

  it('counts earns and prizes in silver and gems, week and all-time', () => {
    const rows = [
      row({ delta: 10 }),
      row({ kind: 'prize', delta: 25, action: 'payout:rings-prize' }),
      row({ currency: 'gems', delta: 2 }),
      row({ delta: 7, at: '2026-11-01T20:00:00.000Z' }),
      row({ currency: 'gems', delta: 1, at: '2025-06-01T20:00:00.000Z' }),
    ];
    expect(sumEarned(rows, window)).toEqual({
      week: { silver: 35, gems: 2 },
      allTime: { silver: 42, gems: 3 },
    });
  });

  it('ignores spends, converts, gold, deposits, passes and negative deltas', () => {
    const rows = [
      row({ delta: 10 }),
      row({ kind: 'spend', delta: -30, action: 'shop' }),
      row({ kind: 'convert', delta: -140, action: 'convert' }),
      row({ kind: 'convert', currency: 'gold', delta: 1, action: 'convert' }),
      row({ kind: 'convert', currency: 'gems', delta: 1, action: 'convert' }),
      row({ currency: 'gold', delta: 3 }),
      row({ kind: 'deposit', delta: 50, action: 'parent-deposit' }),
      row({ kind: 'pass', delta: 0, action: 'pass' }),
      row({ kind: 'adjust', delta: 5, action: 'adjust' }),
      row({ delta: -4 }),
      row({ delta: 'x' }),
      null,
    ];
    expect(sumEarned(rows, window)).toEqual({
      week: { silver: 10, gems: 0 },
      allTime: { silver: 10, gems: 0 },
    });
  });

  it('nets a reversal against the earn it reverses, in that earn\'s bucket, never below zero', () => {
    const rows = [
      row({ delta: 20, ref: 'piano:2026-11-18' }),
      row({ kind: 'adjust', delta: -5, ref: 'reverse:piano:2026-11-18', action: 'reverse', at: '2026-11-25T20:00:00.000Z' }),
      row({ delta: 8, ref: 'old', at: '2026-10-01T20:00:00.000Z' }),
      row({ kind: 'adjust', delta: -8, ref: 'reverse:old', action: 'reverse', at: '2026-11-18T20:00:00.000Z' }),
      row({ kind: 'adjust', delta: -99, ref: 'reverse:unknown', action: 'reverse' }),
    ];
    expect(sumEarned(rows, window)).toEqual({
      week: { silver: 15, gems: 0 },
      allTime: { silver: 15, gems: 0 },
    });
  });

  it('never counts a pass refund: spending handed back is not earned', async () => {
    // Real shape, from EconomyService.refundPass.
    const refund = {
      id: 'txn_r', at: '2026-11-18T21:00:00.000Z', kind: 'earn', currency: 'silver', delta: 30,
      action: 'arcade-refund', source: 'pass', ref: 'pass:kid1:2026-11-18:refund', evidenceRef: 'pass:kid1:2026-11-18',
    };
    const rows = [
      row({ delta: 10 }),
      refund,
      { ...refund, id: 'a', source: 'api' },
      { ...refund, id: 'b', source: 'api', action: 'x', ref: 'refund:pass:kid1:2026-11-18' },
      { ...refund, id: 'c', source: 'api', action: 'x', ref: 'pass:kid1:2026-11-19:refund' },
      { ...refund, id: 'd', action: 'x', ref: null },
    ];
    expect(sumEarned(rows, window)).toEqual({
      week: { silver: 10, gems: 0 },
      allTime: { silver: 10, gems: 0 },
    });
  });

  it('takes a reversal from the bucket of the NEWEST earn under its ref', () => {
    const rev = row({ kind: 'adjust', delta: -6, ref: 'reverse:line:1', action: 'reverse', at: '2026-11-20T20:00:00.000Z' });
    // Same ref paid twice: an older payment before the week, a corrected one inside it.
    const older = row({ delta: 4, ref: 'line:1', at: '2026-11-01T20:00:00.000Z' });
    const newer = row({ delta: 9, ref: 'line:1', at: '2026-11-18T20:00:00.000Z' });
    for (const rows of [[older, newer, rev], [rev, newer, older]]) {
      expect(sumEarned(rows, window)).toEqual({ week: { silver: 3, gems: 0 }, allTime: { silver: 7, gems: 0 } });
    }
  });

  it('treats a row with no currency as silver and skips an unreadable time in the week', () => {
    const rows = [
      { kind: 'earn', delta: 4, at: '2026-11-18T20:00:00.000Z' },
      { kind: 'earn', delta: 3, at: 'not a time' },
    ];
    expect(sumEarned(rows, window)).toEqual({
      week: { silver: 4, gems: 0 },
      allTime: { silver: 7, gems: 0 },
    });
  });

  it('counts the window edges as half-open', () => {
    const rows = [
      row({ delta: 1, at: new Date(window.startMs).toISOString() }),
      row({ delta: 100, at: new Date(window.endMs).toISOString() }),
      row({ delta: 1000, at: new Date(window.startMs - 1).toISOString() }),
    ];
    expect(sumEarned(rows, window).week.silver).toBe(1);
  });

  it('is all zero for no rows', () => {
    expect(sumEarned(null, window)).toEqual({ week: { silver: 0, gems: 0 }, allTime: { silver: 0, gems: 0 } });
  });
});

describe('hasWeekWins', () => {
  it('is true only when some week figure is above zero', () => {
    expect(hasWeekWins({ week: { silver: 0, gems: null, rings: 2 } })).toBe(true);
    expect(hasWeekWins({ week: { silver: 0, gems: 0, rings: null }, allTime: { silver: 9 } })).toBe(false);
    expect(hasWeekWins(null)).toBe(false);
  });
});
