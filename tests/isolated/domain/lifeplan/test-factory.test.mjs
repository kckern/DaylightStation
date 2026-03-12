import { describe, it, expect } from '@jest/globals';
import { createTestLifeplan, createMatchingLifelog } from '../../../_lib/lifeplan-test-factory.mjs';

describe('createTestLifeplan', () => {
  it('returns a valid lifeplan structure with defaults', () => {
    const plan = createTestLifeplan();
    expect(plan.meta.testdata).toBe(true);
    expect(plan.meta.version).toBe('2.0');
    expect(plan.purpose.statement).toBeTruthy();
    expect(plan.cadence.unit.duration).toBe('1 day');
    expect(plan.values).toHaveLength(5);
    expect(plan.beliefs).toHaveLength(4);
    expect(plan.goals).toHaveLength(5);
  });

  it('respects custom options', () => {
    const plan = createTestLifeplan({ goalCount: 3, beliefCount: 2, valueCount: 3 });
    expect(plan.goals).toHaveLength(3);
    expect(plan.beliefs).toHaveLength(2);
    expect(plan.values).toHaveLength(3);
  });

  it('produces deterministic output with same seed', () => {
    const plan1 = createTestLifeplan({ seed: 99 });
    const plan2 = createTestLifeplan({ seed: 99 });
    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  it('produces different output with different seeds', () => {
    const plan1 = createTestLifeplan({ seed: 1 });
    const plan2 = createTestLifeplan({ seed: 2 });
    expect(JSON.stringify(plan1)).not.toBe(JSON.stringify(plan2));
  });

  it('generates goals across multiple states', () => {
    const plan = createTestLifeplan({ goalCount: 6 });
    const states = plan.goals.map(g => g.state);
    expect(states).toContain('dream');
    expect(states).toContain('committed');
  });

  it('generates beliefs with evidence histories', () => {
    const plan = createTestLifeplan({ spanMonths: 6 });
    const beliefWithEvidence = plan.beliefs.find(b => b.evidence && b.evidence.length > 0);
    expect(beliefWithEvidence).toBeTruthy();
  });

  it('includes value_mapping with defaults', () => {
    const plan = createTestLifeplan();
    expect(plan.value_mapping).toBeTruthy();
    expect(plan.value_mapping.category_defaults).toBeTruthy();
  });

  it('generates qualities with principles and rules', () => {
    const plan = createTestLifeplan();
    expect(plan.qualities.length).toBeGreaterThan(0);
    const qualityWithRules = plan.qualities.find(q => q.rules && q.rules.length > 0);
    expect(qualityWithRules).toBeTruthy();
  });

  it('generates cadence config', () => {
    const plan = createTestLifeplan();
    expect(plan.cadence.unit.duration).toBe('1 day');
    expect(plan.cadence.cycle.duration).toBe('7 days');
    expect(plan.cadence.phase.duration).toBe('30 days');
    expect(plan.cadence.season.duration).toBe('90 days');
    expect(plan.cadence.era.duration).toBe('365 days');
  });

  it('generates ceremony config', () => {
    const plan = createTestLifeplan();
    expect(plan.ceremonies).toBeTruthy();
    expect(plan.ceremonies.config).toBeTruthy();
  });
});

describe('createMatchingLifelog', () => {
  it('returns date-keyed data for each source', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    expect(lifelog.strava).toBeTruthy();
    expect(lifelog.calendar).toBeTruthy();
    expect(lifelog.weight).toBeTruthy();
    // Check date-keyed format
    const firstKey = Object.keys(lifelog.strava)[0];
    expect(firstKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('generates strava activities consistent with fitness goals', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    const dates = Object.keys(lifelog.strava);
    expect(dates.length).toBeGreaterThan(0);
    const firstDay = lifelog.strava[dates[0]];
    expect(Array.isArray(firstDay)).toBe(true);
    if (firstDay.length > 0) {
      expect(firstDay[0]).toHaveProperty('title');
      expect(firstDay[0]).toHaveProperty('type');
      expect(firstDay[0]).toHaveProperty('duration');
    }
  });

  it('generates calendar events', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    const dates = Object.keys(lifelog.calendar);
    expect(dates.length).toBeGreaterThan(0);
    const firstDay = lifelog.calendar[dates[0]];
    expect(Array.isArray(firstDay)).toBe(true);
  });

  it('generates weight data', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    const dates = Object.keys(lifelog.weight);
    expect(dates.length).toBeGreaterThan(0);
    const firstDay = lifelog.weight[dates[0]];
    expect(firstDay).toHaveProperty('lbs');
  });
});
