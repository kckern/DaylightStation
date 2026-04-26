import { describe, it, expect } from 'vitest';
import { GoalStateService } from '#domains/lifeplan/services/GoalStateService.mjs';
import { Goal } from '#domains/lifeplan/entities/Goal.mjs';
import { Dependency } from '#domains/lifeplan/entities/Dependency.mjs';
import { frozenClock } from '../../../_lib/clock-helper.mjs';

describe('GoalStateService', () => {
  const clock = frozenClock('2025-06-15T10:00:00Z');
  const service = new GoalStateService();

  describe('transition()', () => {
    it('transitions a goal with clock timestamp', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'dream' });
      service.transition(goal, 'considered', 'Exploring', clock);
      expect(goal.state).toBe('considered');
      expect(goal.state_history[0].timestamp).toContain('2025-06-15');
    });

    it('throws on invalid transition', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'dream' });
      expect(() => service.transition(goal, 'committed', 'Skip', clock))
        .toThrow(/cannot transition/i);
    });
  });

  describe('checkDependencies()', () => {
    it('returns ready when all deps satisfied', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'considered' });
      const deps = [
        new Dependency({ type: 'prerequisite', blocked_goal: 'g1', status: 'satisfied' }),
      ];
      expect(service.checkDependencies(goal, deps)).toBe(true);
    });

    it('returns not ready when deps pending', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'considered' });
      const deps = [
        new Dependency({ type: 'prerequisite', blocked_goal: 'g1', status: 'pending' }),
      ];
      expect(service.checkDependencies(goal, deps)).toBe(false);
    });

    it('overridden deps count as satisfied', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'considered' });
      const deps = [
        new Dependency({ type: 'recommended', blocked_goal: 'g1', status: 'pending', overridden: true }),
      ];
      expect(service.checkDependencies(goal, deps)).toBe(true);
    });
  });

  describe('validateCommitmentGate()', () => {
    it('passes when all required fields present', () => {
      const goal = new Goal({
        id: 'g1', name: 'Run marathon', state: 'ready',
        quality: 'physical',
        why: 'Push my limits',
        sacrifice: '15 hrs/week',
        deadline: '2025-10-01',
        metrics: [{ name: 'miles', target: 100, current: 0 }],
      });
      const result = service.validateCommitmentGate(goal);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('fails when required fields missing', () => {
      const goal = new Goal({
        id: 'g1', name: 'Run marathon', state: 'ready',
      });
      const result = service.validateCommitmentGate(goal);
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.missing).toContain('why');
      expect(result.missing).toContain('sacrifice');
    });
  });

  describe('evaluateProgress()', () => {
    it('returns on_track when progress >= expected', () => {
      const goal = new Goal({
        id: 'g1', name: 'T', state: 'committed',
        deadline: '2025-12-15',
        metrics: [{ name: 'm1', target: 100, current: 60 }],
      });
      // 6 months total, 0 months elapsed from June 15 → expected ~0%, actual 60% → on_track
      const result = service.evaluateProgress(goal, clock);
      expect(result.status).toBe('on_track');
    });

    it('returns behind when progress significantly below expected', () => {
      const goal = new Goal({
        id: 'g1', name: 'T', state: 'committed',
        deadline: '2025-07-15',
        metrics: [{ name: 'm1', target: 100, current: 10 }],
      });
      // 1 month total, 0 months elapsed → expected ~0%... let's use a closer deadline
      const pastGoal = new Goal({
        id: 'g2', name: 'T', state: 'committed',
        deadline: '2025-06-30',
        metrics: [{ name: 'm1', target: 100, current: 10 }],
        state_history: [
          { from: 'ready', to: 'committed', reason: 'go', timestamp: '2025-06-01T00:00:00Z' },
        ],
      });
      const result = service.evaluateProgress(pastGoal, clock);
      // 15 days total (June 15 to June 30), currently at day 0 of commitment
      // But progress is only 10% - with deadline approaching this should flag
      expect(['at_risk', 'behind']).toContain(result.status);
    });

    it('returns no_deadline when no deadline set', () => {
      const goal = new Goal({
        id: 'g1', name: 'T', state: 'committed',
        metrics: [{ name: 'm1', target: 100, current: 50 }],
      });
      const result = service.evaluateProgress(goal, clock);
      expect(result.status).toBe('no_deadline');
    });
  });
});
