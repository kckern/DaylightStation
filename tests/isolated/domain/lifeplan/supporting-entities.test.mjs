import { describe, it, expect } from '@jest/globals';
import { Dependency } from '#domains/lifeplan/entities/Dependency.mjs';
import { LifeEvent } from '#domains/lifeplan/entities/LifeEvent.mjs';
import { AntiGoal } from '#domains/lifeplan/entities/AntiGoal.mjs';
import { Milestone } from '#domains/lifeplan/entities/Milestone.mjs';
import { BeliefOrigin } from '#domains/lifeplan/entities/BeliefOrigin.mjs';
import { Shadow } from '#domains/lifeplan/entities/Shadow.mjs';
import { Ceremony } from '#domains/lifeplan/entities/Ceremony.mjs';
import { CeremonyRecord } from '#domains/lifeplan/entities/CeremonyRecord.mjs';
import { Cycle } from '#domains/lifeplan/entities/Cycle.mjs';
import { FeedbackEntry } from '#domains/lifeplan/entities/FeedbackEntry.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';

describe('Dependency', () => {
  it('creates a prerequisite dependency', () => {
    const dep = new Dependency({
      type: 'prerequisite',
      blocked_goal: 'run-marathon',
      requires_goal: 'lose-100-lbs',
      status: 'pending',
    });
    expect(dep.type).toBe('prerequisite');
    expect(dep.isSatisfied()).toBe(false);
  });

  it('is satisfied when overridden', () => {
    const dep = new Dependency({
      type: 'recommended',
      blocked_goal: 'g1',
      requires_goal: 'g2',
      status: 'pending',
      overridden: true,
    });
    expect(dep.isSatisfied()).toBe(true);
  });

  it('round-trips via toJSON', () => {
    const dep = new Dependency({ type: 'resource', blocked_goal: 'g1', resource: 'savings', threshold: 50000, current: 32000 });
    const restored = new Dependency(dep.toJSON());
    expect(restored.resource).toBe('savings');
    expect(restored.threshold).toBe(50000);
  });
});

describe('LifeEvent', () => {
  it('creates a life event', () => {
    const event = new LifeEvent({
      id: 'baby-born-2024',
      type: 'family',
      name: 'Second child born',
      status: 'anticipated',
      impact_type: 'blocks',
      duration_type: 'temporary',
    });
    expect(event.hasOccurred()).toBe(false);
    expect(event.isPermanent()).toBe(false);
  });

  it('detects occurred permanent events', () => {
    const event = new LifeEvent({
      id: 'disability', type: 'health', name: 'Injury',
      status: 'occurred', impact_type: 'invalidates', duration_type: 'permanent',
    });
    expect(event.hasOccurred()).toBe(true);
    expect(event.isPermanent()).toBe(true);
  });
});

describe('AntiGoal', () => {
  it('creates an anti-goal with nightmare and proximity', () => {
    const ag = new AntiGoal({
      id: 'financial-ruin',
      nightmare: 'End up broke',
      proximity: 'distant',
      motivates_goals: [{ goal: 'build-emergency-fund' }],
    });
    expect(ag.nightmare).toBe('End up broke');
    expect(ag.proximity).toBe('distant');
    expect(ag.motivates_goals).toHaveLength(1);
  });
});

describe('Milestone', () => {
  it('tracks completion', () => {
    const ms = new Milestone({ name: 'First 10k', completed: true, completed_date: '2025-03-01' });
    expect(ms.completed).toBe(true);
    expect(ms.completed_date).toBe('2025-03-01');
  });
});

describe('BeliefOrigin', () => {
  it('captures origin narrative', () => {
    const origin = new BeliefOrigin({
      type: 'experience',
      description: 'Personal career',
      narrative: 'Worked hard and succeeded',
      source_events: ['promotion-2023'],
    });
    expect(origin.type).toBe('experience');
    expect(origin.source_events).toHaveLength(1);
  });
});

describe('Shadow', () => {
  it('tracks shadow quality', () => {
    const shadow = new Shadow({
      name: 'Workaholic',
      description: 'Work consumes everything',
      warning_signals: [{ source: 'calendar', pattern: 'work_hours > 55/week' }],
    });
    expect(shadow.name).toBe('Workaholic');
    expect(shadow.warning_signals).toHaveLength(1);
  });
});

describe('Ceremony', () => {
  it('creates a ceremony definition', () => {
    const ceremony = new Ceremony({
      type: 'unit_start',
      cadence_level: 'unit',
      prompts: ['What is your #1 priority?'],
    });
    expect(ceremony.type).toBe('unit_start');
    expect(ceremony.prompts).toHaveLength(1);
  });
});

describe('CeremonyRecord', () => {
  it('records a completed ceremony', () => {
    const record = new CeremonyRecord({
      type: 'cycle_retro',
      date: '2025-03-01',
      cycle_id: 'cycle-1',
      responses: { priority: 'Ship feature X' },
      duration_minutes: 15,
    });
    expect(record.type).toBe('cycle_retro');
    expect(record.duration_minutes).toBe(15);
  });
});

describe('Cycle', () => {
  it('creates an active cycle', () => {
    const cycle = new Cycle({
      id: 'cycle-1',
      cadence_level: 'cycle',
      start_date: '2025-03-01',
      status: 'active',
    });
    expect(cycle.isActive()).toBe(true);
  });

  it('detects completed cycle', () => {
    const cycle = new Cycle({
      id: 'cycle-1', cadence_level: 'cycle',
      start_date: '2025-02-01', end_date: '2025-02-28',
      status: 'completed',
    });
    expect(cycle.isActive()).toBe(false);
  });
});

describe('FeedbackEntry', () => {
  it('captures feedback with relations', () => {
    const entry = new FeedbackEntry({
      date: '2025-03-01',
      type: 'friction',
      content: 'Afternoon slump derails focus',
      related_rules: ['afternoon-tiredness'],
    });
    expect(entry.type).toBe('friction');
    expect(entry.related_rules).toEqual(['afternoon-tiredness']);
  });
});

describe('LifePlan (aggregate root)', () => {
  const planData = {
    purpose: { statement: 'Maximize joy', adopted: '2024-01-15' },
    goals: [
      { id: 'g1', name: 'Run marathon', state: 'committed' },
      { id: 'g2', name: 'Learn piano', state: 'dream' },
      { id: 'g3', name: 'Old goal', state: 'achieved' },
    ],
    beliefs: [
      { id: 'b1', if: 'X', then: 'Y', state: 'confirmed' },
      { id: 'b2', if: 'A', then: 'B', state: 'testing' },
    ],
    values: [
      { id: 'v1', name: 'Family', rank: 1 },
      { id: 'v2', name: 'Health', rank: 2 },
    ],
    qualities: [
      { id: 'q1', name: 'Physical Vitality' },
    ],
    rules: [
      { id: 'r1', trigger: 'tired', action: 'walk' },
    ],
    dependencies: [
      { type: 'prerequisite', blocked_goal: 'g1', requires_goal: 'g2' },
    ],
    anti_goals: [
      { id: 'ag1', nightmare: 'End up broke' },
    ],
    cycles: [
      { id: 'c1', cadence_level: 'cycle', start_date: '2025-03-01', status: 'active' },
    ],
  };

  it('constructs from full data', () => {
    const plan = new LifePlan(planData);
    expect(plan.purpose.statement).toBe('Maximize joy');
    expect(plan.goals).toHaveLength(3);
    expect(plan.beliefs).toHaveLength(2);
    expect(plan.values).toHaveLength(2);
  });

  it('getGoalsByState filters correctly', () => {
    const plan = new LifePlan(planData);
    expect(plan.getGoalsByState('committed')).toHaveLength(1);
    expect(plan.getGoalsByState('dream')).toHaveLength(1);
    expect(plan.getGoalsByState('paused')).toHaveLength(0);
  });

  it('getActiveGoals excludes terminal states', () => {
    const plan = new LifePlan(planData);
    const active = plan.getActiveGoals();
    expect(active).toHaveLength(2);
    expect(active.map(g => g.id)).toEqual(expect.arrayContaining(['g1', 'g2']));
  });

  it('getBeliefById returns correct belief', () => {
    const plan = new LifePlan(planData);
    expect(plan.getBeliefById('b1').state).toBe('confirmed');
    expect(plan.getBeliefById('b99')).toBeNull();
  });

  it('toJSON produces valid round-trip', () => {
    const plan = new LifePlan(planData);
    const json = plan.toJSON();
    const restored = new LifePlan(json);
    expect(restored.purpose.statement).toBe('Maximize joy');
    expect(restored.goals).toHaveLength(3);
    expect(restored.beliefs).toHaveLength(2);
    expect(restored.values).toHaveLength(2);
    expect(restored.qualities).toHaveLength(1);
    expect(restored.rules).toHaveLength(1);
    expect(restored.dependencies).toHaveLength(1);
    expect(restored.anti_goals).toHaveLength(1);
    expect(restored.cycles).toHaveLength(1);
  });
});
