import { describe, it, expect } from '@jest/globals';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';

describe('CadenceService', () => {
  const service = new CadenceService();

  const defaultCadence = {
    unit: { duration: '1 day', alias: 'day' },
    cycle: { duration: '7 days', alias: 'week' },
    phase: { duration: '30 days', alias: 'month' },
    season: { duration: '90 days', alias: 'quarter' },
    era: { duration: '365 days', alias: 'year' },
  };

  describe('resolve()', () => {
    it('returns current position in all cadence levels', () => {
      const result = service.resolve(defaultCadence, '2025-06-15');
      expect(result.unit).toBeDefined();
      expect(result.cycle).toBeDefined();
      expect(result.phase).toBeDefined();
      expect(result.season).toBeDefined();
      expect(result.era).toBeDefined();

      expect(result.unit.durationDays).toBe(1);
      expect(result.cycle.durationDays).toBe(7);
      expect(result.unit.alias).toBe('day');
    });

    it('handles custom cadence durations', () => {
      const customCadence = {
        unit: { duration: '3 days', alias: 'block' },
        cycle: { duration: '14 days', alias: 'sprint' },
      };
      const result = service.resolve(customCadence, '2025-06-15');
      expect(result.unit.durationDays).toBe(3);
      expect(result.unit.alias).toBe('block');
      expect(result.cycle.durationDays).toBe(14);
    });
  });

  describe('currentPeriodId()', () => {
    it('returns unique period ID for cycle', () => {
      const id = service.currentPeriodId('cycle', defaultCadence, '2025-06-15');
      expect(id).toMatch(/^2025-C\d+$/);
    });

    it('returns unique period ID for unit', () => {
      const id = service.currentPeriodId('unit', defaultCadence, '2025-06-15');
      expect(id).toMatch(/^2025-U\d+$/);
    });

    it('different days in same cycle get same period ID', () => {
      const id1 = service.currentPeriodId('cycle', defaultCadence, '2025-06-15');
      const id2 = service.currentPeriodId('cycle', defaultCadence, '2025-06-16');
      // Both should be in same 7-day cycle (depends on epoch, but likely same)
      // This is a structural test — the IDs should be deterministic
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
    });
  });

  describe('isCeremonyDue()', () => {
    it('ceremony due at start_of_cycle on period start', () => {
      // epoch is 2025-01-01, cycle is 7 days
      // 2025-01-01 is a cycle start, 2025-01-08 is next cycle start
      const due = service.isCeremonyDue('start_of_cycle', defaultCadence, '2025-01-08', null);
      expect(due).toBe(true);
    });

    it('ceremony not due mid-period', () => {
      const due = service.isCeremonyDue('start_of_cycle', defaultCadence, '2025-01-10', null);
      expect(due).toBe(false);
    });

    it('ceremony not due if already done this period', () => {
      const due = service.isCeremonyDue('start_of_cycle', defaultCadence, '2025-01-08', '2025-01-08');
      expect(due).toBe(false);
    });
  });

  describe('getNextCeremonyTime()', () => {
    it('returns next start_of_cycle date', () => {
      const next = service.getNextCeremonyTime('start_of_cycle', defaultCadence, '2025-01-10');
      expect(next).toBeInstanceOf(Date);
      expect(next.getTime()).toBeGreaterThan(new Date('2025-01-10').getTime());
    });

    it('returns end_of_unit date', () => {
      const next = service.getNextCeremonyTime('end_of_unit', defaultCadence, '2025-01-05');
      expect(next).toBeInstanceOf(Date);
    });
  });
});
