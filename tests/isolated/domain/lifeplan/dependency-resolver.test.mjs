import { describe, it, expect } from '@jest/globals';
import { DependencyResolver } from '#domains/lifeplan/services/DependencyResolver.mjs';
import { Goal } from '#domains/lifeplan/entities/Goal.mjs';
import { Dependency } from '#domains/lifeplan/entities/Dependency.mjs';
import { LifeEvent } from '#domains/lifeplan/entities/LifeEvent.mjs';

describe('DependencyResolver', () => {
  const resolver = new DependencyResolver();

  it('prerequisite satisfied when required goal achieved', () => {
    const goal = new Goal({ id: 'marathon', name: 'Run marathon', state: 'considered' });
    const deps = [
      new Dependency({ type: 'prerequisite', blocked_goal: 'marathon', requires_goal: 'lose-weight' }),
    ];
    const goals = [
      new Goal({ id: 'lose-weight', name: 'Lose weight', state: 'achieved' }),
    ];
    expect(resolver.isGoalReady(goal, deps, goals)).toBe(true);
  });

  it('prerequisite not satisfied when required goal not achieved', () => {
    const goal = new Goal({ id: 'marathon', name: 'Run marathon', state: 'considered' });
    const deps = [
      new Dependency({ type: 'prerequisite', blocked_goal: 'marathon', requires_goal: 'lose-weight' }),
    ];
    const goals = [
      new Goal({ id: 'lose-weight', name: 'Lose weight', state: 'committed' }),
    ];
    expect(resolver.isGoalReady(goal, deps, goals)).toBe(false);
  });

  it('life_event satisfied when event occurred', () => {
    const goal = new Goal({ id: 'apply-promo', name: 'Apply', state: 'considered' });
    const deps = [
      new Dependency({ type: 'life_event', blocked_goal: 'apply-promo', awaits_event: 'baby-born' }),
    ];
    const events = [
      new LifeEvent({ id: 'baby-born', type: 'family', name: 'Baby', status: 'occurred' }),
    ];
    expect(resolver.isGoalReady(goal, deps, [], events)).toBe(true);
  });

  it('life_event not satisfied when event anticipated', () => {
    const goal = new Goal({ id: 'apply-promo', name: 'Apply', state: 'considered' });
    const deps = [
      new Dependency({ type: 'life_event', blocked_goal: 'apply-promo', awaits_event: 'baby-born' }),
    ];
    const events = [
      new LifeEvent({ id: 'baby-born', type: 'family', name: 'Baby', status: 'anticipated' }),
    ];
    expect(resolver.isGoalReady(goal, deps, [], events)).toBe(false);
  });

  it('resource satisfied when current >= threshold', () => {
    const goal = new Goal({ id: 'buy-house', name: 'Buy house', state: 'considered' });
    const deps = [
      new Dependency({ type: 'resource', blocked_goal: 'buy-house', resource: 'savings', threshold: 50000, current: 55000 }),
    ];
    expect(resolver.isGoalReady(goal, deps, [])).toBe(true);
  });

  it('resource not satisfied when current < threshold', () => {
    const goal = new Goal({ id: 'buy-house', name: 'Buy house', state: 'considered' });
    const deps = [
      new Dependency({ type: 'resource', blocked_goal: 'buy-house', resource: 'savings', threshold: 50000, current: 32000 }),
    ];
    expect(resolver.isGoalReady(goal, deps, [])).toBe(false);
  });

  it('recommended can be overridden', () => {
    const goal = new Goal({ id: 'business', name: 'Start business', state: 'considered' });
    const deps = [
      new Dependency({ type: 'recommended', blocked_goal: 'business', requires_goal: 'emergency-fund', overridden: true }),
    ];
    expect(resolver.isGoalReady(goal, deps, [])).toBe(true);
  });

  it('ignores deps for other goals', () => {
    const goal = new Goal({ id: 'marathon', name: 'Run marathon', state: 'considered' });
    const deps = [
      new Dependency({ type: 'prerequisite', blocked_goal: 'other-goal', requires_goal: 'something' }),
    ];
    expect(resolver.isGoalReady(goal, deps, [])).toBe(true);
  });
});
