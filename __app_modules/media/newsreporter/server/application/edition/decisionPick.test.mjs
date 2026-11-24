import { describe, it, expect, vi } from 'vitest';
import { buildUnits, questionsFor, decisionPick, assignedCategory, unitValue, OUTLET_BONUS } from './decisionPick.mjs';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

const CATEGORIES = [
  { id: 'us', label: 'Nation', topic: 'US politics and policy', stories: 2 },
  { id: 'world', label: 'World', topic: 'Foreign affairs', stories: 2 },
  { id: 'tech', label: 'Technology', sources: ['ars'], stories: 1 },
];

const cand = (id, sourceId, title, extra = {}) => ({ id, sourceId, sourceLabel: sourceId.toUpperCase(), title, desc: `${title} blurb`, col: extra.col ?? 0, clusterId: extra.clusterId ?? null, url: `https://x/${id}` });

const CANDIDATES = [
  cand('h1', 'bbc', 'Senate passes budget', { clusterId: 'c1', col: 1 }),
  cand('h2', 'cnn', 'Budget clears senate', { clusterId: 'c1', col: 0 }),
  cand('h3', 'fox', 'Senate budget vote', { clusterId: 'c1', col: 2 }),
  cand('h4', 'bbc', 'Summit in Geneva'),
  cand('h5', 'ars', 'New chip design'),
  cand('h6', 'cnn', 'Celebrity buys a boat'),
  cand('h7', 'bbc', 'Minor local spat'),
];

/** A fake Jev: answers by title from a script. */
function fakeGateway(script, { configured = true } = {}) {
  const calls = [];
  return {
    calls,
    isConfigured: () => configured,
    evaluate: vi.fn(async (state, questions) => {
      calls.push({ state, questions });
      const s = script[state.title];
      if (!s || s === 'fail') throw new Error('boom');
      const probabilities = { ...Object.fromEntries(Object.keys(questions.category.options).map((k) => [k, 0.01])), ...s.probs };
      return { model: 'jev-test', answers: { category: { type: 'choice', choice: s.choice, confidence: 0.1, probabilities }, interest: { type: 'score', score: s.interest, confidence: 0.1, probabilities: [] } }, usage: {} };
    }),
  };
}

const SCRIPT = {
  'Senate passes budget': { choice: 'us', probs: { us: 0.9 }, interest: 3 },
  'Summit in Geneva': { choice: 'world', probs: { world: 0.8 }, interest: 3.2 },
  'New chip design': { choice: 'tech', probs: { tech: 0.7 }, interest: 2 },
  'Celebrity buys a boat': { choice: 'none', probs: { none: 0.6, us: 0.3 }, interest: 0.5 },
  'Minor local spat': { choice: 'us', probs: { us: 0.5 }, interest: 1 },
};

describe('units and questions', () => {
  it('makes one unit per cluster plus one per single headline', () => {
    const units = buildUnits(CANDIDATES);
    expect(units).toHaveLength(5);
    expect(units[0]).toMatchObject({ ids: ['h1', 'h2', 'h3'], outlets: 3, sources: ['BBC', 'CNN', 'FOX'] });
    expect(units[0].cols.sort()).toEqual([0, 1, 2]);
  });

  it('offers only the categories a unit is eligible for, always with none', () => {
    const [cluster, , chip] = buildUnits(CANDIDATES);
    expect(Object.keys(questionsFor(cluster, CATEGORIES).category.options)).toEqual(['us', 'world', 'none']);
    expect(Object.keys(questionsFor(chip, CATEGORIES).category.options)).toEqual(['us', 'world', 'tech', 'none']);
    const onlyTech = [{ id: 'tech', label: 'Tech', sources: ['ars'], stories: 1 }];
    expect(Object.keys(questionsFor(chip, onlyTech).category.options)).toEqual(['tech', 'none']);
    expect(questionsFor(cluster, onlyTech)).toBeNull();
    expect(questionsFor(chip, CATEGORIES).interest.levels).toHaveLength(5);
  });

  it('none wins only when its probability is the largest', () => {
    expect(assignedCategory({ choice: 'none', probabilities: { none: 0.6, us: 0.3 } })).toBeNull();
    expect(assignedCategory({ choice: 'us', probabilities: { none: 0.3, us: 0.5 } })).toBe('us');
    expect(assignedCategory({ choice: 'none', probabilities: { none: 0.3, world: 0.5 } })).toBe('world');
  });

  it('adds a bonus per extra outlet', () => {
    expect(unitValue(2, 1)).toBe(2);
    expect(unitValue(2, 3)).toBeCloseTo(2 + 2 * OUTLET_BONUS);
  });
});

describe('decisionPick', () => {
  it('ranks, excludes none, and takes the multi-outlet lead out of its category', async () => {
    const gateway = fakeGateway(SCRIPT);
    const pick = await decisionPick({ gateway, candidates: CANDIDATES, categories: CATEGORIES, logger: quiet() });
    // The budget cluster: 3 + 2 × 0.15 = 3.3 beats Geneva's 3.2, and it has 3 outlets: the lead.
    expect(pick.lead).toEqual(['h1', 'h2', 'h3']);
    expect(pick.categories).toEqual([
      { id: 'us', stories: [{ ids: ['h7'], rank: 1, interest: 1 }] },
      { id: 'world', stories: [{ ids: ['h4'], rank: 1, interest: 3.2 }] },
      { id: 'tech', stories: [{ ids: ['h5'], rank: 1, interest: 2 }] },
    ]);
    expect(pick.interest.get('h6')).toBeUndefined();
    expect(pick).toMatchObject({ units: 5, failed: 0 });
    expect(gateway.evaluate).toHaveBeenCalledTimes(5);
  });

  it('the outlet bonus can lift a story over a slightly more interesting single', async () => {
    const script = { ...SCRIPT, 'Summit in Geneva': { choice: 'us', probs: { us: 0.9 }, interest: 3.2 } };
    const pick = await decisionPick({ gateway: fakeGateway(script), candidates: CANDIDATES, categories: CATEGORIES, leadEnabled: false, logger: quiet() });
    expect(pick.lead).toBeNull();
    expect(pick.categories[0].stories.map((s) => s.ids[0])).toEqual(['h1', 'h4']);
  });

  it('takes any unit as lead when none has two outlets', async () => {
    const singles = CANDIDATES.map((c) => ({ ...c, clusterId: null }));
    const pick = await decisionPick({ gateway: fakeGateway(SCRIPT), candidates: singles, categories: CATEGORIES, logger: quiet() });
    expect(pick.lead).toEqual(['h4']);
  });

  it('skips a failed unit and counts it', async () => {
    const logger = quiet();
    const pick = await decisionPick({ gateway: fakeGateway({ ...SCRIPT, 'Minor local spat': 'fail' }), candidates: CANDIDATES, categories: CATEGORIES, logger });
    expect(pick.failed).toBe(1);
    expect(pick.categories.find((c) => c.id === 'us')).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('newsreporter.edition.pick.unit_failed', expect.objectContaining({ unit: 'single:h7' }));
  });

  it('falls back (null) on a missing or unconfigured gateway', async () => {
    expect(await decisionPick({ gateway: null, candidates: CANDIDATES, categories: CATEGORIES })).toBeNull();
    expect(await decisionPick({ gateway: fakeGateway(SCRIPT, { configured: false }), candidates: CANDIDATES, categories: CATEGORIES })).toBeNull();
  });

  it('falls back (null) when more than half the calls fail', async () => {
    const script = { 'Senate passes budget': SCRIPT['Senate passes budget'], 'Summit in Geneva': SCRIPT['Summit in Geneva'] };
    expect(await decisionPick({ gateway: fakeGateway(script), candidates: CANDIDATES, categories: CATEGORIES, logger: quiet() })).toBeNull();
  });

  it('balance: lean breaks ties toward wider column coverage', async () => {
    const cands = [
      cand('a1', 'bbc', 'Narrow', { clusterId: 'n', col: 0 }), cand('a2', 'cnn', 'Narrow too', { clusterId: 'n', col: 0 }),
      cand('b1', 'bbc', 'Wide', { clusterId: 'w', col: 0 }), cand('b2', 'fox', 'Wide too', { clusterId: 'w', col: 2 }),
    ];
    const script = { Narrow: { choice: 'us', probs: { us: 0.9 }, interest: 2 }, Wide: { choice: 'us', probs: { us: 0.9 }, interest: 2 } };
    const cats = [{ id: 'us', label: 'Nation', stories: 1, balance: 'lean' }];
    const pick = await decisionPick({ gateway: fakeGateway(script), candidates: cands, categories: cats, leadEnabled: false, logger: quiet() });
    expect(pick.categories[0].stories[0].ids).toEqual(['b1', 'b2']);
  });
});
