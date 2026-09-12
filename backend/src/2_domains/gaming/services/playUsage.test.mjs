import { describe, it, expect } from 'vitest';
import { summariseUsage, formatDuration, UNATTRIBUTED } from './playUsage.mjs';

const MIN = 60_000;
const session = (over = {}) => ({
  id: 's1', startedAt: '2026-09-12T10:00:00.000Z', endedAt: '2026-09-12T10:20:00.000Z',
  deviceId: 'livingroom-tv', userId: 'child-a', content: { contentId: 'g:1', title: 'Game One' },
  playedMs: 10 * MIN, confidenceMs: 10_000, status: 'ended', endReason: 'quit', ...over,
});

describe('summariseUsage', () => {
  it('totals played time, not wall clock', () => {
    // The session above ran 20 minutes and was PLAYED for 10.
    const r = summariseUsage([session()]);
    expect(r.totalPlayedMs).toBe(10 * MIN);
    expect(r.sessionCount).toBe(1);
  });

  it('groups by player, title, device and day', () => {
    const r = summariseUsage([
      session({ id: 's1', userId: 'child-a', playedMs: 10 * MIN }),
      session({ id: 's2', userId: 'child-b', playedMs: 5 * MIN, content: { contentId: 'g:2', title: 'Game Two' } }),
      session({ id: 's3', userId: 'child-a', playedMs: 20 * MIN, startedAt: '2026-09-13T09:00:00.000Z' }),
    ]);
    expect(r.byUser[0]).toMatchObject({ key: 'child-a', playedMs: 30 * MIN, sessions: 2 });
    expect(r.byTitle[0]).toMatchObject({ key: 'Game One', playedMs: 30 * MIN });
    expect(r.byDevice[0]).toMatchObject({ key: 'livingroom-tv', sessions: 3 });
    expect(r.byDay.map((d) => d.key)).toEqual(['2026-09-12', '2026-09-13']);
  });

  it('ranks the heaviest use first, which is what a person is looking for', () => {
    const r = summariseUsage([
      session({ id: 's1', userId: 'light', playedMs: 2 * MIN }),
      session({ id: 's2', userId: 'heavy', playedMs: 60 * MIN }),
    ]);
    expect(r.byUser.map((u) => u.key)).toEqual(['heavy', 'light']);
  });

  it('counts a session whose player is unknown rather than dropping it', () => {
    // Dropping it would understate the ledger exactly where it is least
    // trustworthy.
    const r = summariseUsage([session({ userId: null })]);
    expect(r.byUser[0].key).toBe(UNATTRIBUTED);
    expect(r.totalPlayedMs).toBe(10 * MIN);
  });

  it('prefers the payer when a session had several participants', () => {
    const r = summariseUsage([session({ payerId: 'payer', userId: 'payer', participants: ['payer', 'sibling'] })]);
    expect(r.byUser[0].key).toBe('payer');
    expect(r.sessions[0].participants).toEqual(['payer', 'sibling']);
  });

  it('carries how precisely each figure was measured', () => {
    expect(summariseUsage([session()]).sessions[0].confidenceMs).toBe(10_000);
  });

  it('handles an empty ledger', () => {
    expect(summariseUsage([])).toMatchObject({ totalPlayedMs: 0, sessionCount: 0, byUser: [], sessions: [] });
  });

  it('names an unidentified title rather than showing a blank', () => {
    expect(summariseUsage([session({ content: null })]).byTitle[0].key).toBe('(unidentified)');
  });
});

describe('formatDuration', () => {
  it('reads as a person would say it', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(4 * MIN + 30_000)).toBe('4m 30s');
    expect(formatDuration(72 * MIN)).toBe('1h 12m');
  });
  it('never shows a negative', () => { expect(formatDuration(-1)).toBe('0s'); });
});
