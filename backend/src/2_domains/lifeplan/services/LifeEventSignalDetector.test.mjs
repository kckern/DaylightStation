import { describe, it, expect } from 'vitest';
import {
  LifeEventSignalDetector, LIFE_EVENT_SIGNAL_KINDS, calendarItemsForDay, toSuggestion,
} from './LifeEventSignalDetector.mjs';
import { LifeEventType } from '../value-objects/LifeEventType.mjs';

const day = (...summaries) => ({ sources: { calendar: summaries.map((summary) => ({ summary })) } });

describe('LifeEventSignalDetector', () => {
  const detector = new LifeEventSignalDetector();

  it('maps every signal kind to a domain LifeEventType', () => {
    for (const type of Object.values(LIFE_EVENT_SIGNAL_KINDS)) {
      expect(LifeEventType.isValid(type)).toBe(true);
    }
  });

  it('emits domain-shaped suggestions (type + subtype)', () => {
    const out = detector.detectFromLifelog({ '2026-09-20': day('Moving day - new apartment', 'Team meeting') });
    expect(out).toEqual([{
      date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day - new apartment',
      source: 'calendar', confidence: 0.8, detector: 'keyword',
    }]);
  });

  it('matches whole words only: a birthday is not a birth, an example is not an exam', () => {
    expect(detector.detectFromLifelog({ '2026-09-20': day("Mom's birthday", 'Worked example review') })).toEqual([]);
    expect(detector.detectFromLifelog({ '2026-09-20': day('Birth of baby Kern') })[0].subtype).toBe('family_event');
  });

  it('emits at most one suggestion per calendar item (first matching pattern wins)', () => {
    const out = detector.detectFromLifelog({ '2026-09-20': day('First day back after surgery') });
    expect(out).toHaveLength(1);
    expect(out[0].subtype).toBe('job_change');
  });

  it('does not treat travel as a life event', () => {
    expect(detector.detectFromLifelog({ '2026-09-20': day('Flight to Denver', 'Hotel check-in') })).toEqual([]);
  });

  it('reads the categories shape when sources is absent', () => {
    const days = { '2026-09-20': { categories: { calendar: { calendar: [{ summary: 'Graduation' }] } } } };
    expect(detector.detectFromLifelog(days)[0].type).toBe('education');
  });

  it('classify returns null for routine items and empty summaries', () => {
    expect(detector.classify({ summary: 'Standup' })).toBeNull();
    expect(detector.classify({})).toBeNull();
  });

  it('calendarItemsForDay tolerates missing data and {events} wrappers', () => {
    expect(calendarItemsForDay(undefined)).toEqual([]);
    expect(calendarItemsForDay({ sources: { calendar: { events: [{ summary: 'x' }] } } })).toEqual([{ summary: 'x' }]);
  });

  it('toSuggestion maps kind to type and keeps the kind as subtype', () => {
    expect(toSuggestion('2026-09-01', { summary: 'Retirement party' }, 'financial', 0.9, 'model'))
      .toEqual({ date: '2026-09-01', type: 'financial', subtype: 'financial', name: 'Retirement party', source: 'calendar', confidence: 0.9, detector: 'model' });
  });
});
