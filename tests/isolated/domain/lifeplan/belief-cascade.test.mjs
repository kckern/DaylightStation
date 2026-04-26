import { describe, it, expect } from 'vitest';
import { BeliefCascadeProcessor } from '#domains/lifeplan/services/BeliefCascadeProcessor.mjs';
import { Belief } from '#domains/lifeplan/entities/Belief.mjs';
import { Value } from '#domains/lifeplan/entities/Value.mjs';
import { Quality } from '#domains/lifeplan/entities/Quality.mjs';
import { Purpose } from '#domains/lifeplan/entities/Purpose.mjs';

describe('BeliefCascadeProcessor', () => {
  const processor = new BeliefCascadeProcessor();

  const allBeliefs = [
    new Belief({ id: 'meritocracy', if: 'work hard', then: 'succeed', foundational: true, state: 'refuted' }),
    new Belief({ id: 'derived-1', if: 'work 60hrs', then: 'advance', depends_on: ['meritocracy'] }),
    new Belief({ id: 'derived-2', if: 'lazy', then: 'fail', depends_on: ['meritocracy'] }),
    new Belief({ id: 'unrelated', if: 'eat well', then: 'healthy' }),
  ];

  const values = [
    new Value({ id: 'achievement', name: 'Achievement', justified_by: [{ belief: 'meritocracy' }] }),
    new Value({ id: 'family', name: 'Family' }),
  ];

  const qualities = [
    new Quality({ id: 'industrious', name: 'Industrious', grounded_in: { beliefs: ['meritocracy'], values: ['achievement'] } }),
    new Quality({ id: 'healthy', name: 'Healthy', grounded_in: { beliefs: ['health-belief'], values: ['vitality'] } }),
  ];

  const purpose = new Purpose({
    statement: 'Build wealth through excellence',
    grounded_in: {
      beliefs: [{ id: 'meritocracy' }, { id: 'mastery' }],
      values: [],
    },
  });

  describe('processRefutation()', () => {
    it('non-foundational refutation does not cascade', () => {
      const nonFoundational = new Belief({ id: 'trivial', if: 'X', then: 'Y', foundational: false });
      const result = processor.processRefutation(nonFoundational, allBeliefs, values, qualities, purpose);
      expect(result.beliefs_questioning).toHaveLength(0);
      expect(result.values_review).toHaveLength(0);
      expect(result.qualities_review).toHaveLength(0);
      expect(result.purpose_threatened).toBe(false);
    });

    it('foundational refutation cascades to dependent beliefs', () => {
      const result = processor.processRefutation(allBeliefs[0], allBeliefs, values, qualities, purpose);
      expect(result.beliefs_questioning).toEqual(['derived-1', 'derived-2']);
    });

    it('foundational refutation flags justified values for review', () => {
      const result = processor.processRefutation(allBeliefs[0], allBeliefs, values, qualities, purpose);
      expect(result.values_review).toEqual(['achievement']);
    });

    it('foundational refutation flags grounded qualities for review', () => {
      const result = processor.processRefutation(allBeliefs[0], allBeliefs, values, qualities, purpose);
      expect(result.qualities_review).toEqual(['industrious']);
    });

    it('foundational refutation threatens purpose when grounded_in includes refuted belief', () => {
      const result = processor.processRefutation(allBeliefs[0], allBeliefs, values, qualities, purpose);
      expect(result.purpose_threatened).toBe(true);
    });

    it('purpose not threatened when belief not in grounded_in', () => {
      const unrelatedBelief = new Belief({ id: 'other', if: 'X', then: 'Y', foundational: true });
      const result = processor.processRefutation(unrelatedBelief, allBeliefs, values, qualities, purpose);
      expect(result.purpose_threatened).toBe(false);
    });
  });

  describe('detectParadigmCollapse()', () => {
    it('returns true when 3+ foundational beliefs refuted in season', () => {
      const beliefs = [
        new Belief({ id: 'f1', if: 'X', then: 'Y', foundational: true }),
        new Belief({ id: 'f2', if: 'X', then: 'Y', foundational: true }),
        new Belief({ id: 'f3', if: 'X', then: 'Y', foundational: true }),
      ];
      expect(processor.detectParadigmCollapse(beliefs, ['f1', 'f2', 'f3'])).toBe(true);
    });

    it('returns false when < 3 foundational beliefs refuted', () => {
      const beliefs = [
        new Belief({ id: 'f1', if: 'X', then: 'Y', foundational: true }),
        new Belief({ id: 'f2', if: 'X', then: 'Y', foundational: true }),
      ];
      expect(processor.detectParadigmCollapse(beliefs, ['f1', 'f2'])).toBe(false);
    });

    it('only counts foundational beliefs', () => {
      const beliefs = [
        new Belief({ id: 'f1', if: 'X', then: 'Y', foundational: true }),
        new Belief({ id: 'nf1', if: 'X', then: 'Y', foundational: false }),
        new Belief({ id: 'nf2', if: 'X', then: 'Y', foundational: false }),
      ];
      expect(processor.detectParadigmCollapse(beliefs, ['f1', 'nf1', 'nf2'])).toBe(false);
    });
  });
});
