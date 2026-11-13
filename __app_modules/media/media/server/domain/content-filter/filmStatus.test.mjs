import { describe, expect, it } from 'vitest';
import { filmStatus, NEXT_ACTIONS } from './filmStatus.mjs';

// The two questions a grown-up asks of a film (are there filters? are they refined?) and the one
// thing to do next. T2 on 2026-11-12: refined (95 of 243 measured), machine-certified, no audit.
const refined = (measured = 95, of = 243) => ({ timebase: { refinedCount: measured }, cues: new Array(of).fill({}) });
const fresh = { ok: true, fresh: true };

describe('filmStatus', () => {
  it('T2: refined, machine-certified, no audit yet -> checking', () => {
    expect(filmStatus({ rawCueCount: 243, refined: refined(), audit: null, auditRunning: false, job: null, certificationLevel: 'machine' })).toEqual({
      filters: { present: true, parts: 243 }, refined: { present: true, measured: 95, of: 243 }, certified: 'machine', next: 'checking',
    });
  });
  it('no EDL at all -> none', () => {
    expect(filmStatus({ rawCueCount: 0, refined: null }).next).toBe('none');
    expect(filmStatus({ rawCueCount: 0, refined: null }).filters).toEqual({ present: false, parts: 0 });
  });
  it('a queued or running job -> running, even before anything is refined', () => {
    expect(filmStatus({ rawCueCount: 220, refined: null, job: { status: 'running' } }).next).toBe('running');
    expect(filmStatus({ rawCueCount: 220, refined: null, job: { status: 'queued' } }).next).toBe('running');
  });
  it('a finished, failed or interrupted job does not hold the film', () => {
    for (const status of ['done', 'failed', 'interrupted', 'cancelled']) {
      expect(filmStatus({ rawCueCount: 220, refined: null, job: { status } }).next).toBe('refine');
    }
  });
  it('rough only -> refine, measured 0 of the rough parts', () => {
    expect(filmStatus({ rawCueCount: 220, refined: null })).toMatchObject({ refined: { present: false, measured: 0, of: 220 }, next: 'refine' });
  });
  it('a stale audit -> checking', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: { ok: true, fresh: false } }).next).toBe('checking');
  });
  it('parent-certified -> done', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: fresh, certificationLevel: 'parent' }).next).toBe('done');
  });
  it('rows without a verdict or waiting for redo -> review', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: fresh, certificationLevel: 'machine', rowsOpen: 2 }).next).toBe('review');
  });
  it('everything reviewed -> approve', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: fresh, certificationLevel: 'machine', rowsOpen: 0, signOffReady: true }).next).toBe('approve');
  });
  it('NEXT_ACTIONS lists every value', () => {
    expect(NEXT_ACTIONS).toEqual(['none', 'refine', 'running', 'checking', 'check-failed', 'review', 'approve', 'done']);
    expect(Object.isFrozen(NEXT_ACTIONS)).toBe(true);
  });

  it('a failed check (no fresh audit, not running) -> check-failed', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: null, auditFailed: true }).next).toBe('check-failed');
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: { fresh: false }, auditFailed: true }).next).toBe('check-failed');
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: null, auditFailed: true, auditRunning: true }).next).toBe('checking');
    expect(NEXT_ACTIONS).toContain('check-failed');
  });
  it('everything reviewed but sign-off not ready (mutes uncovered, audit failed) -> review, never an Approve that 409s', () => {
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: fresh, certificationLevel: 'none', rowsOpen: 0, signOffReady: false }).next).toBe('review');
    expect(filmStatus({ rawCueCount: 5, refined: refined(3, 5), audit: fresh, certificationLevel: 'machine', rowsOpen: 0, signOffReady: true }).next).toBe('approve');
  });
});

