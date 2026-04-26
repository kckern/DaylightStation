import { describe, it, expect } from 'vitest';
import { Goal } from '#domains/lifeplan/entities/Goal.mjs';

describe('Goal Entity', () => {
  describe('construction', () => {
    it('creates a goal from minimal data', () => {
      const goal = new Goal({
        id: 'run-marathon',
        name: 'Run a marathon',
        state: 'dream',
      });
      expect(goal.id).toBe('run-marathon');
      expect(goal.name).toBe('Run a marathon');
      expect(goal.state).toBe('dream');
    });

    it('creates a committed goal with all required fields', () => {
      const goal = new Goal({
        id: 'run-marathon',
        name: 'Run a marathon',
        state: 'committed',
        quality: 'physical',
        why: 'Prove I can push my limits',
        sacrifice: '15 hours/week training',
        deadline: '2025-10-01',
        metrics: [{ name: 'weekly_miles', target: 30, current: 12 }],
        audacity: 8,
      });
      expect(goal.state).toBe('committed');
      expect(goal.deadline).toBe('2025-10-01');
      expect(goal.metrics).toHaveLength(1);
    });
  });

  describe('transition()', () => {
    it('transitions dream → considered', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'dream' });
      goal.transition('considered', 'Exploring this idea');
      expect(goal.state).toBe('considered');
      expect(goal.state_history).toHaveLength(1);
      expect(goal.state_history[0].from).toBe('dream');
      expect(goal.state_history[0].to).toBe('considered');
      expect(goal.state_history[0].reason).toBe('Exploring this idea');
    });

    it('throws on invalid transition', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'dream' });
      expect(() => goal.transition('committed', 'Skipping ahead'))
        .toThrow(/cannot transition/i);
    });

    it('throws on transition from terminal state', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'achieved' });
      expect(() => goal.transition('dream', 'Re-dreaming'))
        .toThrow(/cannot transition/i);
    });

    it('records timestamp on transition', () => {
      const goal = new Goal({ id: 'g1', name: 'Test', state: 'dream' });
      goal.transition('considered', 'reason');
      expect(goal.state_history[0].timestamp).toBeTruthy();
    });
  });

  describe('isTerminal()', () => {
    it('returns true for achieved', () => {
      const goal = new Goal({ id: 'g1', name: 'T', state: 'achieved' });
      expect(goal.isTerminal()).toBe(true);
    });

    it('returns true for abandoned', () => {
      const goal = new Goal({ id: 'g1', name: 'T', state: 'abandoned' });
      expect(goal.isTerminal()).toBe(true);
    });

    it('returns false for committed', () => {
      const goal = new Goal({ id: 'g1', name: 'T', state: 'committed' });
      expect(goal.isTerminal()).toBe(false);
    });
  });

  describe('progress', () => {
    it('calculates progress from metrics', () => {
      const goal = new Goal({
        id: 'g1', name: 'T', state: 'committed',
        metrics: [
          { name: 'miles', target: 100, current: 42 },
          { name: 'sessions', target: 20, current: 10 },
        ],
      });
      const progress = goal.getProgress();
      // Average of (42/100 + 10/20) / 2 = (0.42 + 0.5) / 2 = 0.46
      expect(progress).toBeCloseTo(0.46, 2);
    });

    it('returns 0 when no metrics', () => {
      const goal = new Goal({ id: 'g1', name: 'T', state: 'dream' });
      expect(goal.getProgress()).toBe(0);
    });

    it('caps progress at 1.0', () => {
      const goal = new Goal({
        id: 'g1', name: 'T', state: 'committed',
        metrics: [{ name: 'miles', target: 100, current: 150 }],
      });
      expect(goal.getProgress()).toBe(1);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        id: 'run-marathon',
        name: 'Run a marathon',
        state: 'committed',
        quality: 'physical',
        why: 'Prove myself',
        sacrifice: '15 hrs/week',
        deadline: '2025-10-01',
        metrics: [{ name: 'miles', target: 100, current: 42 }],
        audacity: 8,
        milestones: [{ name: 'First 10k', completed: true }],
        state_history: [{ from: 'dream', to: 'considered', reason: 'test', timestamp: '2025-01-01' }],
      };
      const goal = new Goal(data);
      const json = goal.toJSON();
      const restored = new Goal(json);
      expect(restored.id).toBe('run-marathon');
      expect(restored.state).toBe('committed');
      expect(restored.metrics).toHaveLength(1);
      expect(restored.state_history).toHaveLength(1);
    });
  });
});
