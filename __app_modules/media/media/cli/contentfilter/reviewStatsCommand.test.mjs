import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { netVerdicts, parseSince, runReviewStats, formatReviewStats } from './reviewStatsCommand.mjs';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const e = (rowId, verdict, at, extra = {}) => ({
  at, by: 'tester', rowId, kind: 'word', category: 'language', modality: 'audio', effect: 'bleep',
  verdict, dwellMs: 1000, machine: { stage: 'machine', unsure: [], handFixed: false }, film: { stage: 'machine' }, ...extra,
});
let dir;
const put = (rk, entries) => writeFileSync(path.join(dir, `${rk}.yml`), yaml.dump({ entries }));
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'rstats-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('netVerdicts', () => {
  it('an undo cancels the verdict it follows; a re-verdict replaces', () => {
    const net = netVerdicts([
      e('a', 'approve', '2026-11-09T10:00:00Z'), e('a', 'undo', '2026-11-09T10:01:00Z'),
      e('b', 'remove', '2026-11-09T10:02:00Z'), e('b', 'approve', '2026-11-09T10:03:00Z'),
      e('c', 'redo', '2026-11-09T10:04:00Z'), e('c', 'undo', '2026-11-09T10:05:00Z'), e('c', 'ignore', '2026-11-09T10:06:00Z'),
    ]);
    expect(net.map((x) => `${x.rowId}:${x.verdict}`).sort()).toEqual(['b:approve', 'c:ignore']);
  });
});

describe('parseSince', () => {
  it('reads Nd, Nh and dates; rejects junk', () => {
    expect(parseSince('30d', NOW)).toBe(NOW - 30 * 86400000);
    expect(parseSince('2h', NOW)).toBe(NOW - 7200000);
    expect(parseSince('2026-11-01', NOW)).toBe(Date.parse('2026-11-01'));
    expect(() => parseSince('soon', NOW)).toThrow();
  });
});

describe('runReviewStats', () => {
  it('aggregates net verdicts across films', () => {
    put('100', [
      e('a', 'approve', '2026-11-09T10:00:00Z', { change: { from: 'bleep', to: 'mute' } }),
      e('b', 'remove', '2026-11-09T10:00:00Z', { kind: 'picture', category: 'violence', effect: 'blur', machine: { stage: 'scenes', unsure: ['subject-unsure'] }, dwellMs: 3000 }),
      e('x', 'approve', '2026-11-09T10:00:00Z'), e('x', 'undo', '2026-11-09T10:01:00Z'),
    ]);
    put('200', [
      e('c', 'redo', '2026-11-09T11:00:00Z', { reason: 'timing', dwellMs: 5000 }),
      e('d', 'approve', '2026-11-09T11:00:00Z'),
      e('old', 'remove', '2026-09-01T11:00:00Z'),
    ]);
    const r = runReviewStats({ historyDir: dir, flags: { since: '30d' }, now: NOW });
    expect(r.films).toBe(2);
    expect(r.rows).toBe(4);
    expect(r.verdicts).toEqual({ approve: 2, remove: 1, redo: 1 });
    expect(r.byKind.picture).toMatchObject({ total: 1, remove: 1 });
    expect(r.removeRateByMachineStage.scenes).toEqual({ rows: 1, removed: 1, removeRate: 1 });
    expect(r.removeRateByMachineStage.machine).toEqual({ rows: 3, removed: 0, removeRate: 0 });
    expect(r.removeRateByUnsure['subject-unsure']).toEqual({ rows: 1, removed: 1, removeRate: 1 });
    expect(r.changeMatrix).toEqual({ 'bleep -> mute': 1 });
    expect(r.redoReasons).toEqual({ timing: 1 });
    expect(r.dwellMs).toEqual({ median: 2000, n: 4 });
  });

  it('filters by rk and handles no history', () => {
    put('100', [e('a', 'approve', '2026-11-09T10:00:00Z')]);
    put('200', [e('b', 'remove', '2026-11-09T10:00:00Z')]);
    expect(runReviewStats({ historyDir: dir, flags: { rk: '200' }, now: NOW }).verdicts).toEqual({ remove: 1 });
    const none = runReviewStats({ historyDir: path.join(dir, 'missing'), flags: {}, now: NOW });
    expect(none.rows).toBe(0);
    expect(formatReviewStats(none)).toContain('No review history');
  });

  it('prints a table', () => {
    put('100', [e('a', 'approve', '2026-11-09T10:00:00Z')]);
    expect(formatReviewStats(runReviewStats({ historyDir: dir, flags: {}, now: NOW }))).toContain('Remove rate by machine stage');
  });
});
