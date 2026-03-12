import { describe, it, expect } from '@jest/globals';
import { Quality } from '#domains/lifeplan/entities/Quality.mjs';
import { Rule } from '#domains/lifeplan/entities/Rule.mjs';
import { Purpose } from '#domains/lifeplan/entities/Purpose.mjs';

describe('Quality Entity', () => {
  describe('construction', () => {
    it('creates a quality with principles and rules', () => {
      const quality = new Quality({
        id: 'physical',
        name: 'Physical Vitality',
        description: 'Maintain energy through health',
        principles: ['Prioritize sleep', 'Move daily'],
        rules: [{ id: 'afternoon-tiredness', trigger: 'tired', action: 'walk' }],
      });
      expect(quality.id).toBe('physical');
      expect(quality.principles).toHaveLength(2);
      expect(quality.rules).toHaveLength(1);
    });

    it('tracks grounded_in beliefs and values', () => {
      const quality = new Quality({
        id: 'industrious',
        name: 'Industrious',
        grounded_in: {
          beliefs: ['meritocracy'],
          values: ['achievement'],
        },
      });
      expect(quality.grounded_in.beliefs).toEqual(['meritocracy']);
      expect(quality.grounded_in.values).toEqual(['achievement']);
    });

    it('tracks shadow quality', () => {
      const quality = new Quality({
        id: 'industrious',
        name: 'Industrious',
        shadow: {
          name: 'Workaholic',
          description: 'Work consumes everything',
          warning_signals: [{ source: 'calendar', pattern: 'work_hours > 55/week' }],
        },
        shadow_state: 'emerging',
      });
      expect(quality.shadow.name).toBe('Workaholic');
      expect(quality.shadow_state).toBe('emerging');
    });
  });

  describe('allGroundingRefuted()', () => {
    it('returns true when all grounding beliefs refuted', () => {
      const quality = new Quality({
        id: 'q1', name: 'Q',
        grounded_in: { beliefs: ['b1', 'b2'], values: [] },
      });
      expect(quality.allGroundingRefuted(['b1', 'b2'])).toBe(true);
    });

    it('returns false when some grounding beliefs remain', () => {
      const quality = new Quality({
        id: 'q1', name: 'Q',
        grounded_in: { beliefs: ['b1', 'b2'], values: [] },
      });
      expect(quality.allGroundingRefuted(['b1'])).toBe(false);
    });

    it('returns false when no grounding beliefs', () => {
      const quality = new Quality({ id: 'q1', name: 'Q' });
      expect(quality.allGroundingRefuted(['anything'])).toBe(false);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        id: 'physical',
        name: 'Physical Vitality',
        description: 'Health and energy',
        principles: ['Sleep first'],
        rules: [{ id: 'r1', trigger: 'tired', action: 'walk' }],
        grounded_in: { beliefs: ['health'], values: ['vitality'] },
        shadow: { name: 'Obsessive', description: 'Over-exercising' },
        shadow_state: 'dormant',
        last_shadow_check: '2025-06-01',
      };
      const quality = new Quality(data);
      const restored = new Quality(quality.toJSON());
      expect(restored.id).toBe('physical');
      expect(restored.principles).toHaveLength(1);
      expect(restored.shadow.name).toBe('Obsessive');
      expect(restored.shadow_state).toBe('dormant');
    });
  });
});

describe('Rule Entity', () => {
  describe('construction', () => {
    it('creates a rule with trigger and action', () => {
      const rule = new Rule({
        id: 'afternoon-tiredness',
        trigger: 'Feeling tired after lunch',
        action: 'Take a 15-min walk',
        quality_id: 'physical',
      });
      expect(rule.id).toBe('afternoon-tiredness');
      expect(rule.trigger).toBe('Feeling tired after lunch');
      expect(rule.action).toBe('Take a 15-min walk');
      expect(rule.state).toBe('defined');
    });
  });

  describe('evaluateEffectiveness()', () => {
    it('returns untested when never triggered', () => {
      const rule = new Rule({ id: 'r1', trigger: 'X', action: 'Y' });
      expect(rule.evaluateEffectiveness()).toBe('untested');
    });

    it('returns effective when follow and help rates >= 70%', () => {
      const rule = new Rule({
        id: 'r1', trigger: 'X', action: 'Y',
        times_triggered: 10, times_followed: 8, times_helped: 7,
      });
      expect(rule.evaluateEffectiveness()).toBe('effective');
    });

    it('returns not_followed when follow rate < 50%', () => {
      const rule = new Rule({
        id: 'r1', trigger: 'X', action: 'Y',
        times_triggered: 10, times_followed: 4, times_helped: 4,
      });
      expect(rule.evaluateEffectiveness()).toBe('not_followed');
    });

    it('returns ineffective when help rate < 50%', () => {
      const rule = new Rule({
        id: 'r1', trigger: 'X', action: 'Y',
        times_triggered: 10, times_followed: 8, times_helped: 3,
      });
      expect(rule.evaluateEffectiveness()).toBe('ineffective');
    });

    it('returns mixed for moderate rates', () => {
      const rule = new Rule({
        id: 'r1', trigger: 'X', action: 'Y',
        times_triggered: 10, times_followed: 6, times_helped: 4,
      });
      expect(rule.evaluateEffectiveness()).toBe('mixed');
    });
  });

  describe('recordTrigger()', () => {
    it('increments counters and transitions to tested', () => {
      const rule = new Rule({ id: 'r1', trigger: 'X', action: 'Y' });
      rule.recordTrigger({ followed: true, helped: true });
      expect(rule.times_triggered).toBe(1);
      expect(rule.times_followed).toBe(1);
      expect(rule.times_helped).toBe(1);
      expect(rule.state).toBe('tested');
    });

    it('only increments triggered when not followed', () => {
      const rule = new Rule({ id: 'r1', trigger: 'X', action: 'Y' });
      rule.recordTrigger({ followed: false, helped: false });
      expect(rule.times_triggered).toBe(1);
      expect(rule.times_followed).toBe(0);
      expect(rule.times_helped).toBe(0);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        id: 'r1', trigger: 'tired', action: 'walk',
        quality_id: 'physical', state: 'tested',
        times_triggered: 5, times_followed: 4, times_helped: 3,
      };
      const rule = new Rule(data);
      const restored = new Rule(rule.toJSON());
      expect(restored.id).toBe('r1');
      expect(restored.state).toBe('tested');
      expect(restored.times_triggered).toBe(5);
    });
  });
});

describe('Purpose Entity', () => {
  describe('construction', () => {
    it('creates a purpose with statement and grounding', () => {
      const purpose = new Purpose({
        statement: 'To maximize joy through meaningful contribution',
        adopted: '2024-01-15',
        last_reviewed: '2024-06-01',
        review_cadence: 'era',
        grounded_in: {
          beliefs: [
            { id: 'meaning-from-contribution', note: 'Contributing creates meaning' },
          ],
          values: [
            { id: 'impact', note: 'Making a difference' },
          ],
        },
      });
      expect(purpose.statement).toBe('To maximize joy through meaningful contribution');
      expect(purpose.adopted).toBe('2024-01-15');
      expect(purpose.grounded_in.beliefs).toHaveLength(1);
    });
  });

  describe('needsReview()', () => {
    it('returns true when any grounding belief is refuted', () => {
      const purpose = new Purpose({
        statement: 'Test',
        grounded_in: {
          beliefs: [{ id: 'b1' }, { id: 'b2' }],
          values: [],
        },
      });
      expect(purpose.needsReview(['b1'])).toBe(true);
    });

    it('returns false when no grounding beliefs are refuted', () => {
      const purpose = new Purpose({
        statement: 'Test',
        grounded_in: {
          beliefs: [{ id: 'b1' }],
          values: [],
        },
      });
      expect(purpose.needsReview(['b99'])).toBe(false);
    });

    it('returns false when no grounding beliefs', () => {
      const purpose = new Purpose({ statement: 'Test' });
      expect(purpose.needsReview(['anything'])).toBe(false);
    });
  });

  describe('allGroundingsRefuted()', () => {
    it('returns true when all grounding beliefs refuted', () => {
      const purpose = new Purpose({
        statement: 'Test',
        grounded_in: {
          beliefs: [{ id: 'b1' }, { id: 'b2' }],
          values: [],
        },
      });
      expect(purpose.allGroundingsRefuted(['b1', 'b2'])).toBe(true);
    });

    it('returns false when some remain', () => {
      const purpose = new Purpose({
        statement: 'Test',
        grounded_in: {
          beliefs: [{ id: 'b1' }, { id: 'b2' }],
          values: [],
        },
      });
      expect(purpose.allGroundingsRefuted(['b1'])).toBe(false);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        statement: 'To maximize joy',
        adopted: '2024-01-15',
        last_reviewed: '2024-06-01',
        review_cadence: 'era',
        notes: 'From JOP',
        grounded_in: {
          beliefs: [{ id: 'b1', note: 'test' }],
          values: [{ id: 'v1', note: 'test' }],
        },
      };
      const purpose = new Purpose(data);
      const restored = new Purpose(purpose.toJSON());
      expect(restored.statement).toBe('To maximize joy');
      expect(restored.adopted).toBe('2024-01-15');
      expect(restored.grounded_in.beliefs).toHaveLength(1);
    });
  });
});
