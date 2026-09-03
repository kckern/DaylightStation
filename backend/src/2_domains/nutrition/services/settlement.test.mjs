import { describe, it, expect } from 'vitest';
import { effectiveSettled, presentSettlement, AUTO_SETTLE_DAYS } from './settlement.mjs';

describe('effectiveSettled', () => {
  it('absent settled field = settled (legacy rows)', () => {
    expect(effectiveSettled({ date: '2026-09-01' }, '2026-09-02')).toBe(true);
  });
  it('settled:true = settled', () => {
    expect(effectiveSettled({ settled: true, date: '2026-09-02' }, '2026-09-02')).toBe(true);
  });
  it('settled:false within window = unsettled', () => {
    expect(effectiveSettled({ settled: false, date: '2026-09-01' }, '2026-09-02')).toBe(false);
  });
  it('settled:false older than AUTO_SETTLE_DAYS = auto-settled', () => {
    expect(AUTO_SETTLE_DAYS).toBe(3);
    expect(effectiveSettled({ settled: false, date: '2026-08-28' }, '2026-09-02')).toBe(true);
  });
  it('uses createdAt date prefix when present', () => {
    expect(effectiveSettled({ settled: false, createdAt: '2026-08-28 09:00:00', date: '2026-09-02' }, '2026-09-02')).toBe(true);
  });
  it('presentSettlement reports auto for aged rows', () => {
    expect(presentSettlement({ settled: false, date: '2026-08-20' }, '2026-09-02')).toEqual({ settled: true, settledBy: 'auto' });
    expect(presentSettlement({ settled: false, date: '2026-09-02' }, '2026-09-02')).toEqual({ settled: false, settledBy: null });
    expect(presentSettlement({ settled: true, settledBy: 'user', date: '2026-09-02' }, '2026-09-02')).toEqual({ settled: true, settledBy: 'user' });
  });
  it('3-day boundary: exactly 3 days old = still unsettled', () => {
    expect(effectiveSettled({ settled: false, date: '2026-08-30' }, '2026-09-02')).toBe(false);
    expect(presentSettlement({ settled: false, date: '2026-08-30' }, '2026-09-02')).toEqual({ settled: false, settledBy: null });
  });
  it('4-day boundary: 4 days old = auto-settled', () => {
    expect(effectiveSettled({ settled: false, date: '2026-08-29' }, '2026-09-02')).toBe(true);
    expect(presentSettlement({ settled: false, date: '2026-08-29' }, '2026-09-02')).toEqual({ settled: true, settledBy: 'auto' });
  });
  it('malformed/missing date: no date = settled', () => {
    expect(effectiveSettled({ settled: false }, '2026-09-02')).toBe(true);
  });
  it('malformed/missing date: invalid date string = settled', () => {
    expect(effectiveSettled({ settled: false, date: 'not-a-date' }, '2026-09-02')).toBe(true);
  });
});
