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
});
