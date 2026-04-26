import { describe, it, expect } from 'vitest';
import { RuleMatchingService } from '#domains/lifeplan/services/RuleMatchingService.mjs';
import { ProgressCalculator } from '#domains/lifeplan/services/ProgressCalculator.mjs';
import { LifeEventProcessor } from '#domains/lifeplan/services/LifeEventProcessor.mjs';
import { BiasCalibrationService } from '#domains/lifeplan/services/BiasCalibrationService.mjs';
import { ShadowDetectionService } from '#domains/lifeplan/services/ShadowDetectionService.mjs';
import { NightmareProximityService } from '#domains/lifeplan/services/NightmareProximityService.mjs';
import { PastProcessingService } from '#domains/lifeplan/services/PastProcessingService.mjs';

describe('RuleMatchingService', () => {
  const svc = new RuleMatchingService();

  const qualities = [
    {
      id: 'q1', name: 'Discipline',
      rules: [
        { trigger: 'alarm rings', action: 'get up immediately', times_triggered: 10, times_followed: 8, times_helped: 7 },
        { trigger: 'feeling lazy', action: 'do 5 minutes', times_triggered: 5, times_followed: 2, times_helped: 1 },
      ],
    },
  ];

  it('returns matching rules for context', () => {
    const rules = svc.getApplicableRules(qualities, { situation: 'alarm rings' });
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toBe('get up immediately');
  });

  it('returns empty for no matching context', () => {
    const rules = svc.getApplicableRules(qualities, { situation: 'eating dinner' });
    expect(rules).toHaveLength(0);
  });

  it('records outcome correctly', () => {
    const rule = { times_triggered: 0, times_followed: 0, times_helped: 0 };
    svc.recordOutcome(rule, { followed: true, helped: true });
    expect(rule.times_triggered).toBe(1);
    expect(rule.times_followed).toBe(1);
    expect(rule.times_helped).toBe(1);
  });

  it('calculates effectiveness', () => {
    expect(svc.getEffectiveness(qualities[0].rules[0])).toBe('effective');
    expect(svc.getEffectiveness(qualities[0].rules[1])).toBe('not_followed');
    expect(svc.getEffectiveness({ times_triggered: 0 })).toBe('untested');
  });
});

describe('ProgressCalculator', () => {
  const calc = new ProgressCalculator();

  it('calculates metric progress', () => {
    const goal = { metrics: [{ current: 5, target: 10 }, { current: 8, target: 10 }] };
    expect(calc.calculateMetricProgress(goal)).toBe(0.65);
  });

  it('calculates milestone progress', () => {
    const goal = { milestones: [{ completed: true }, { completed: false }, { completed: true }] };
    expect(calc.calculateMilestoneProgress(goal)).toBeCloseTo(0.667, 2);
  });

  it('returns null for no metrics', () => {
    expect(calc.calculateMetricProgress({ metrics: [] })).toBeNull();
  });

  it('calculates composite with status', () => {
    const goal = {
      metrics: [{ current: 2, target: 10 }],
      milestones: [{ completed: false }, { completed: false }],
      deadline: '2025-12-31',
      state_history: [{ to: 'committed', timestamp: '2025-01-01T00:00:00Z' }],
    };
    const result = calc.calculateComposite(goal, new Date('2025-07-01'));
    expect(result.progress).toBe(0.1);
    expect(result.status).toBe('behind');
  });
});

describe('LifeEventProcessor', () => {
  const proc = new LifeEventProcessor();

  it('processes occurred event resolving dependency', () => {
    const event = { type: 'relocation', name: 'Move to new city', state: 'occurred' };
    const plan = {
      goals: [{ id: 'g1', name: 'Join local gym', dependencies: [{ type: 'life_event', event_type: 'relocation' }] }],
      values: [],
    };
    const impacts = proc.processEvent(event, plan);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].action).toBe('dependency_resolved');
  });

  it('returns empty for no matching dependencies', () => {
    const event = { type: 'wedding', name: 'Get married', state: 'occurred' };
    const plan = { goals: [], values: [] };
    expect(proc.processEvent(event, plan)).toHaveLength(0);
  });

  it('gets anticipated events', () => {
    const plan = { life_events: [
      { state: 'anticipated', name: 'Move' },
      { state: 'occurred', name: 'Wedding' },
    ]};
    expect(proc.getAnticipatedEvents(plan)).toHaveLength(1);
  });
});

describe('BiasCalibrationService', () => {
  const svc = new BiasCalibrationService();

  it('detects confirmation bias', () => {
    const belief = {
      evidence_history: [
        ...Array(8).fill({ type: 'confirmation' }),
        { type: 'disconfirmation' },
      ],
    };
    const result = svc.calculateBias(belief);
    expect(result.biasType).toBe('confirmation_bias');
    expect(result.biasScore).toBeGreaterThan(0.3);
  });

  it('returns insufficient data for few entries', () => {
    const belief = { evidence_history: [{ type: 'confirmation' }] };
    expect(svc.calculateBias(belief).biasType).toBe('insufficient_data');
  });

  it('returns no bias for balanced evidence', () => {
    const belief = {
      evidence_history: [
        { type: 'confirmation' }, { type: 'disconfirmation' },
        { type: 'confirmation' }, { type: 'disconfirmation' },
        { type: 'confirmation' },
      ],
    };
    expect(svc.calculateBias(belief).biasType).toBe('none');
  });

  it('blocks transition when bias too high', () => {
    const belief = {
      evidence_history: Array(10).fill({ type: 'confirmation' }),
    };
    expect(svc.isBlockedByBias(belief)).toBe(true);
  });
});

describe('ShadowDetectionService', () => {
  const svc = new ShadowDetectionService();

  it('detects shadow when indicators match feedback', () => {
    const qualities = [{
      id: 'q1', name: 'Discipline',
      shadow: {
        name: 'Rigidity',
        description: 'Inflexible adherence to rules',
        indicators: ['inflexible', 'too strict', 'cant relax'],
      },
    }];
    const feedback = [
      { text: 'Felt inflexible about the schedule today', timestamp: '2025-06-10' },
      { text: 'Was too strict with myself', timestamp: '2025-06-11' },
    ];

    const alerts = svc.detectShadows(qualities, feedback);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].shadow_name).toBe('Rigidity');
    expect(alerts[0].severity).toBe('low');
  });

  it('returns empty when no shadow matches', () => {
    const qualities = [{ id: 'q1', shadow: { indicators: ['x', 'y'] } }];
    const feedback = [{ text: 'Great day' }];
    expect(svc.detectShadows(qualities, feedback)).toHaveLength(0);
  });
});

describe('NightmareProximityService', () => {
  const svc = new NightmareProximityService();

  it('detects high proximity when indicators trigger', () => {
    const antiGoals = [{
      id: 'ag1', name: 'Sedentary lifestyle',
      indicators: [
        { type: 'value_drift', value_id: 'v1' },
        { type: 'goal_failure', goal_id: 'g1' },
      ],
    }];
    const plan = {
      values: [{ id: 'v1', name: 'Health', alignment_state: 'reconsidering' }],
      goals: [{ id: 'g1', name: 'Run marathon', state: 'failed' }],
      beliefs: [],
    };

    const alerts = svc.evaluateProximity(antiGoals, plan);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].proximity).toBe(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('returns empty when no indicators trigger', () => {
    const antiGoals = [{
      id: 'ag1', name: 'test',
      indicators: [{ type: 'value_drift', value_id: 'v1' }],
    }];
    const plan = { values: [{ id: 'v1', alignment_state: 'aligned' }], goals: [], beliefs: [] };
    expect(svc.evaluateProximity(antiGoals, plan)).toHaveLength(0);
  });
});

describe('PastProcessingService', () => {
  const svc = new PastProcessingService();

  it('extracts beliefs from experience', () => {
    const experience = {
      situation: 'morning exercise',
      lesson: 'better focus all day',
      description: 'Started exercising in the morning',
      date: '2025-01-15',
    };
    const beliefs = svc.extractBeliefsFromExperience(experience);
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0].if_hypothesis).toBe('morning exercise');
    expect(beliefs[0].then_expectation).toBe('better focus all day');
    expect(beliefs[0].state).toBe('hypothesized');
  });

  it('suggests quality from pattern', () => {
    const pattern = {
      name: 'Consistency',
      behavior: 'daily routine',
      outcome: 'better results',
      trigger: 'start of day',
      action: 'follow routine',
    };
    const quality = svc.suggestQualityFromPattern(pattern);
    expect(quality.name).toBe('Consistency');
    expect(quality.rules).toHaveLength(1);
  });

  it('processes narrative extracting beliefs', () => {
    const narrative = {
      events: [
        { type: 'experience', description: 'Failed at goal', lesson: 'need better planning', date: '2025-01-01' },
        { type: 'observation', description: 'Good weather', date: '2025-01-02' },
      ],
    };
    const result = svc.processNarrative(narrative);
    expect(result.entries).toHaveLength(2);
    expect(result.suggestedBeliefs).toHaveLength(1);
  });
});
