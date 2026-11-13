import { describe, expect, it } from 'vitest';
import { formatEta, measureEta, runPhases } from './runProgress.js';

const at = (s) => new Date(Date.parse('2026-11-12T23:00:00Z') + s * 1000).toISOString();
// T2's run as the worker reports it: preflight done, refine measuring.
const t2 = {
  kind: 'make', status: 'running', step: 'refine',
  steps: [
    { name: 'preflight', status: 'done' }, { name: 'export', status: 'skipped' },
    { name: 'refine', status: 'running', progress: { phase: 'measure', done: 3, total: 220, firstAt: at(0), recent: [] } },
  ],
};

describe('runPhases', () => {
  it('a make run in refine: preflight and sync done, measuring running with its count, the rest waiting', () => {
    expect(runPhases(t2)).toEqual([
      { key: 'preflight', label: 'Checking the machine', state: 'done' },
      { key: 'sync', label: "Syncing the film's clock", state: 'done' },
      { key: 'measure', label: 'Measuring each part', state: 'running', count: { done: 3, total: 220 } },
      { key: 'scenes', label: 'Building scenes', state: 'waiting' },
      { key: 'cards', label: 'Drafting cards', state: 'waiting' },
      { key: 'audit', label: 'Checking the result', state: 'waiting' },
    ]);
  });
  it('refine still syncing: sync running, measuring waiting', () => {
    const job = { ...t2, steps: [{ name: 'preflight', status: 'done' }, { name: 'refine', status: 'running', progress: { phase: 'sync', done: 0, total: null } }] };
    const p = runPhases(job);
    expect(p.find((x) => x.key === 'sync').state).toBe('running');
    expect(p.find((x) => x.key === 'measure').state).toBe('waiting');
  });
  it('refine running with no progress (an older worker): sync and measure both read as running', () => {
    const job = { ...t2, steps: [{ name: 'preflight', status: 'done' }, { name: 'refine', status: 'running' }] };
    expect(runPhases(job).find((x) => x.key === 'measure')).toEqual({ key: 'measure', label: 'Measuring each part', state: 'running' });
  });
  it('a skipped step reads as done; a failed one as failed', () => {
    const job = { kind: 'make', status: 'failed', step: 'scenes', steps: [{ name: 'preflight', status: 'done' }, { name: 'refine', status: 'done' }, { name: 'scenes', status: 'failed' }] };
    const p = runPhases(job);
    expect(p.find((x) => x.key === 'measure').state).toBe('done');
    expect(p.find((x) => x.key === 'scenes').state).toBe('failed');
  });
  it('a send-back has no scenes or cards phase', () => {
    expect(runPhases({ kind: 'send-back', status: 'queued', steps: [] }).map((x) => x.key)).toEqual(['preflight', 'sync', 'measure', 'audit']);
  });
});

describe('measureEta', () => {
  const p = (done, total) => ({ phase: 'measure', done, total, firstAt: at(0) });
  it('waits for 3 parts before guessing', () => {
    expect(measureEta({ progress: p(2, 220), now: Date.parse(at(600)) })).toBeNull();
    expect(measureEta({ progress: { ...p(5, 220), firstAt: null }, now: Date.parse(at(600)) })).toBeNull();
  });
  it('time per part so far times the parts left', () => {
    expect(measureEta({ progress: p(6, 220), now: Date.parse(at(600)) })).toBe(21400);
  });
});

describe('formatEta', () => {
  it('reads like a person would say it', () => {
    expect(formatEta(21400)).toBe('about 5 h 57 min');
    expect(formatEta(2400)).toBe('about 40 min');
    expect(formatEta(30)).toBe('under a minute');
    expect(formatEta(null)).toBe(null);
  });
});
