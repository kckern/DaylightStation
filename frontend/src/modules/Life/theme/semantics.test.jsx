import { describe, it, expect } from 'vitest';
import { goalStateColor, beliefConfidenceColor, driftStatusColor, priorityTypeMeta } from './semantics.js';

describe('life semantic colors', () => {
  it('maps every goal state to one stable color', () => {
    expect(goalStateColor('committed')).toBe('green');
    expect(goalStateColor('dream')).toBe('grape');
    expect(goalStateColor('nonsense')).toBe('gray');
  });
  it('bands belief confidence', () => {
    expect(beliefConfidenceColor(0.9)).toBe('green');
    expect(beliefConfidenceColor(0.6)).toBe('yellow');
    expect(beliefConfidenceColor(0.2)).toBe('red');
  });
  it('colors drift status without leaking the enum', () => {
    expect(driftStatusColor('aligned')).toBe('green');
    expect(driftStatusColor('reconsidering')).toBe('red');
    expect(driftStatusColor('insufficient_data')).toBe('gray');
  });
  it('exposes priority metadata for the four alert types plus new ones', () => {
    expect(priorityTypeMeta.ceremony_due.label).toBe('Ritual');
    expect(priorityTypeMeta.drift_alert.color).toBe('yellow');
    expect(priorityTypeMeta.plan_gap).toBeTruthy();
  });
});
