/**
 * One event prints once (2026-11-23 dry run: NATO's space-defence pledge came
 * from BBC and France 24 as two World stories, and the Sea-Tac ICE arrests as
 * two Puget Sound stories). A unit that is the same event as a story already
 * kept joins it as extra coverage instead of printing again.
 */
import { describe, it, expect, vi } from 'vitest';
import { decisionPick, mightBeSameEvent, contentWords } from './decisionPick.mjs';
import { taskText } from './editionGather.mjs';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

const cand = (id, sourceId, title) => ({ id, sourceId, sourceLabel: sourceId.toUpperCase(), title, desc: '', col: 0, clusterId: null, url: `https://x/${id}` });

const CATEGORIES = [{ id: 'world', label: 'World', topic: 'Foreign affairs', stories: 3 }];

/** Classifies by a script; answers same-event questions from a set of title pairs. */
function fakeGateway(script, samePairs) {
  return {
    isConfigured: () => true,
    evaluate: vi.fn(async (state, questions) => {
      if (questions.same) {
        const key = [state.a.title, state.b.title].sort().join(' | ');
        return { answers: { same: { type: 'yesNo', probability: samePairs.has(key) ? 0.9 : 0.1 } } };
      }
      const s = script[state.title];
      return { answers: {
        category: { type: 'choice', choice: 'world', probabilities: { world: 0.9, none: 0.1 } },
        interest: { type: 'score', score: s, probabilities: [] },
      } };
    }),
  };
}

const NATO_BBC = 'Nato chief vows defence against space threat after Russian nuclear satellite reports';
const NATO_F24 = 'NATO vows space defence after Russia nuclear satellite report';
const ZELENSKY = 'Zelensky urges four-way peace talks with Russia, Europe and US';

describe('same-event merging in the pick', () => {
  it('merges a second outlet of a kept event into that story', async () => {
    const candidates = [cand('a', 'bbc', NATO_BBC), cand('b', 'f24', NATO_F24), cand('c', 'f24', ZELENSKY)];
    const gateway = fakeGateway({ [NATO_BBC]: 3, [NATO_F24]: 2.9, [ZELENSKY]: 2.5 },
      new Set([[NATO_BBC, NATO_F24].sort().join(' | ')]));
    const pick = await decisionPick({ gateway, candidates, categories: CATEGORIES, leadEnabled: false, logger: quiet() });
    expect(pick.categories[0].stories.map((s) => s.ids)).toEqual([['a', 'b'], ['c']]);
    expect(pick.merged).toBe(1);
  });

  it('merges into the lead too', async () => {
    const candidates = [cand('a', 'bbc', NATO_BBC), cand('b', 'f24', NATO_F24), cand('c', 'f24', ZELENSKY)];
    const gateway = fakeGateway({ [NATO_BBC]: 3, [NATO_F24]: 2.9, [ZELENSKY]: 2.5 },
      new Set([[NATO_BBC, NATO_F24].sort().join(' | ')]));
    const pick = await decisionPick({ gateway, candidates, categories: CATEGORIES, logger: quiet() });
    expect(pick.lead).toEqual(['a', 'b']);
    expect(pick.categories[0].stories.map((s) => s.ids)).toEqual([['c']]);
  });

  it('keeps both when the model says different events', async () => {
    const candidates = [cand('a', 'bbc', NATO_BBC), cand('b', 'f24', NATO_F24)];
    const gateway = fakeGateway({ [NATO_BBC]: 3, [NATO_F24]: 2.9 }, new Set());
    const pick = await decisionPick({ gateway, candidates, categories: CATEGORIES, leadEnabled: false, logger: quiet() });
    expect(pick.categories[0].stories).toHaveLength(2);
    expect(pick.merged).toBe(0);
  });

  it('never asks about pairs with fewer than two shared content words', async () => {
    const candidates = [cand('a', 'bbc', NATO_BBC), cand('c', 'f24', 'Floods close mountain passes')];
    const gateway = fakeGateway({ [NATO_BBC]: 3, 'Floods close mountain passes': 2 }, new Set());
    await decisionPick({ gateway, candidates, categories: CATEGORIES, leadEnabled: false, logger: quiet() });
    expect(gateway.evaluate.mock.calls.filter(([, q]) => q.same)).toHaveLength(0);
  });

  it('prefilter folds plurals and defence/defense', () => {
    expect(contentWords('Reports of defence satellites')).toEqual(new Set(['report', 'defense', 'satellite']));
    expect(mightBeSameEvent({ title: NATO_BBC, blurb: '' }, { title: NATO_F24, blurb: '' })).toBe(true);
    expect(mightBeSameEvent({ title: NATO_BBC, blurb: '' }, { title: 'Floods close mountain passes', blurb: '' })).toBe(false);
  });
});

describe('taskText', () => {
  it('keeps link text, drops URLs and collapses space', () => {
    expect(taskText('[My Discoveries](https://www.ancestry.com/inst/discoveries/?o_xid=59215&x=1)')).toBe('My Discoveries');
    expect(taskText('Read https://example.com/a  later')).toBe('Read later');
    expect(taskText('Paint Garage Sides (get newspapers)')).toBe('Paint Garage Sides (get newspapers)');
  });
});
