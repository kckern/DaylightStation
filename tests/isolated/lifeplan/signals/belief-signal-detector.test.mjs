import { describe, it, expect } from '@jest/globals';
import { BeliefSignalDetector } from '#adapters/lifeplan/signals/BeliefSignalDetector.mjs';
import { LifeEventSignalDetector } from '#adapters/lifeplan/signals/LifeEventSignalDetector.mjs';

describe('BeliefSignalDetector', () => {
  const detector = new BeliefSignalDetector();

  it('detects confirmation when both if and then are met', () => {
    const belief = {
      if_signal: { source: 'strava', measure: 'distance', threshold: 5000 },
      then_signal: { category: 'health' },
    };
    const days = {
      '2025-06-15': {
        sources: { strava: { distance: 8000 } },
        categories: { health: { weight: { value: 75 } } },
        summaries: [],
      },
    };

    const evidence = detector.detectSignals(belief, days);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe('confirmation');
    expect(evidence[0].did_if).toBe(true);
    expect(evidence[0].got_then).toBe(true);
  });

  it('detects disconfirmation when if met but then not', () => {
    const belief = {
      if_signal: { source: 'strava' },
      then_signal: { source: 'weight', measure: 'value', threshold: 70 },
    };
    const days = {
      '2025-06-15': {
        sources: { strava: { distance: 5000 } },
        categories: {},
        summaries: [],
      },
    };

    const evidence = detector.detectSignals(belief, days);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe('disconfirmation');
  });

  it('returns empty when if condition not met', () => {
    const belief = {
      if_signal: { source: 'strava', measure: 'distance', threshold: 10000 },
      then_signal: { category: 'health' },
    };
    const days = {
      '2025-06-15': {
        sources: { strava: { distance: 3000 } },
        categories: {},
        summaries: [],
      },
    };

    expect(detector.detectSignals(belief, days)).toHaveLength(0);
  });

  it('supports keyword-based signals', () => {
    const belief = {
      if_signal: { keyword: 'meditation' },
      then_signal: { keyword: 'productive' },
    };
    const days = {
      '2025-06-15': {
        sources: {},
        categories: {},
        summaries: [
          { text: 'Did morning meditation' },
          { text: 'Very productive day' },
        ],
      },
    };

    const evidence = detector.detectSignals(belief, days);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe('confirmation');
  });

  it('returns empty for belief without signals', () => {
    const belief = { id: 'b1' };
    expect(detector.detectSignals(belief, {})).toHaveLength(0);
  });
});

describe('LifeEventSignalDetector', () => {
  const detector = new LifeEventSignalDetector();

  it('detects life events from calendar data', () => {
    const days = {
      '2025-06-15': {
        sources: { calendar: [
          { summary: 'Moving day - new apartment' },
          { summary: 'Team meeting' },
        ]},
        categories: { calendar: { calendar: [
          { summary: 'Moving day - new apartment' },
        ]}},
        summaries: [],
      },
    };

    const suggestions = detector.detectFromLifelog(days);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].type).toBe('relocation');
  });

  it('returns empty for no matching events', () => {
    const days = {
      '2025-06-15': {
        sources: { calendar: [{ summary: 'Regular standup' }] },
        categories: {},
        summaries: [],
      },
    };

    expect(detector.detectFromLifelog(days)).toHaveLength(0);
  });
});
