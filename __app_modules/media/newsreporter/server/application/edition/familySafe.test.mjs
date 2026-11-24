/**
 * Family-safe screening (KC, 2026-11-23: "war okay, grok making csam, not okay").
 */
import { describe, it, expect, vi } from 'vitest';
import { decisionPick, questionsFor, buildUnits } from './decisionPick.mjs';
import { screenWritten, isMature } from './familySafe.mjs';
import { editionConfigSchema } from './editionConfig.mjs';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });
const cand = (id, sourceId, title) => ({ id, sourceId, sourceLabel: sourceId.toUpperCase(), title, desc: '', col: 0, clusterId: null, url: `https://x/${id}` });
const CATEGORIES = [{ id: 'world', label: 'World', topic: 'Foreign affairs', stories: 3 }];

const GROK = 'States sue SpaceX to stop Grok from generating child sex images';
const WAR = 'Zelensky urges four-way peace talks as shelling continues';

/** Jev fake: `mature` probability per title; everything else is a plain world story. */
function gateway(matureByTitle) {
  return {
    isConfigured: () => true,
    evaluate: vi.fn(async (state, questions) => {
      const answers = {};
      if (questions.category) answers.category = { type: 'choice', choice: 'world', probabilities: { world: 0.9, none: 0.1 } };
      if (questions.interest) answers.interest = { type: 'score', score: 3, probabilities: [] };
      if (questions.mature) answers.mature = { type: 'yesNo', probability: matureByTitle[state.title] ?? 0.05 };
      return { answers };
    }),
  };
}

describe('the pick screens every story unit', () => {
  it('asks the mature question only when screening is on', () => {
    const [unit] = buildUnits([cand('a', 'bbc', WAR)]);
    expect(questionsFor(unit, CATEGORIES).mature).toBeUndefined();
    expect(questionsFor(unit, CATEGORIES, { familySafe: true }).mature.type).toBe('yesNo');
  });

  it('drops the CSAM story and keeps the war story', async () => {
    const pick = await decisionPick({
      gateway: gateway({ [GROK]: 0.93, [WAR]: 0.08 }),
      candidates: [cand('g', 'ars', GROK), cand('w', 'f24', WAR)],
      categories: CATEGORIES, leadEnabled: false, familySafe: { enabled: true, threshold: 0.5 }, logger: quiet(),
    });
    expect(pick.categories[0].stories.map((s) => s.ids)).toEqual([['w']]);
    expect(pick.mature).toEqual([GROK]);
  });

  it('keeps everything when screening is off', async () => {
    const pick = await decisionPick({
      gateway: gateway({ [GROK]: 0.93 }),
      candidates: [cand('g', 'ars', GROK), cand('w', 'f24', WAR)],
      categories: CATEGORIES, leadEnabled: false, familySafe: { enabled: false }, logger: quiet(),
    });
    expect(pick.categories[0].stories).toHaveLength(2);
  });
});

describe('the written edition is screened again', () => {
  const written = {
    lead: { headline: 'Peace talks proposed', body: 'War news.', ids: ['w'] },
    sections: [{ category: 'world', label: 'World', stories: [
      { headline: 'Court case detail', body: 'Graphic abuse detail from the article.', ids: ['c'] },
      { headline: 'Rates hold', body: 'Central bank holds rates.', ids: ['r'] },
    ] }],
    briefs: [{ text: 'A brief', ids: ['b'] }],
  };

  it('removes a written story flagged from its body and keeps the rest', async () => {
    const gw = { isConfigured: () => true, evaluate: vi.fn(async (state) => ({ answers: { mature: { probability: state.body.includes('Graphic') ? 0.9 : 0.05 } } })) };
    const out = await screenWritten({ written, gateway: gw, logger: quiet() });
    expect(out.removed).toEqual(['Court case detail']);
    expect(out.written.sections[0].stories.map((s) => s.headline)).toEqual(['Rates hold']);
    expect(out.written.lead.headline).toBe('Peace talks proposed');
    expect(out.checked).toBe(4);
  });

  it('drops an emptied section and a flagged lead', async () => {
    const gw = { isConfigured: () => true, evaluate: vi.fn(async () => ({ answers: { mature: { probability: 0.9 } } })) };
    const out = await screenWritten({ written, gateway: gw, logger: quiet() });
    expect(out.written.lead).toBeNull();
    expect(out.written.sections).toEqual([]);
    expect(out.written.briefs).toEqual([]);
  });

  it('leaves the edition alone with no decision gateway', async () => {
    const out = await screenWritten({ written, gateway: null, logger: quiet() });
    expect(out.written).toBe(written);
    expect(out.checked).toBe(0);
  });

  it('isMature compares the probability to the threshold', () => {
    expect(isMature({ probability: 0.51 })).toBe(true);
    expect(isMature({ probability: 0.5 })).toBe(false);
    expect(isMature({ probability: 0.3 }, 0.25)).toBe(true);
  });
});

describe('config', () => {
  it('turns family_safe on by default', () => {
    const cfg = editionConfigSchema.parse({
      kind: 'edition', title: 'T', schedule: '30 5 * * *', deliver: { printer: 'office' },
      news: { user: 'u', categories: [{ id: 'world', label: 'World', topic: 't', stories: 2 }] }, day: {},
    });
    expect(cfg.family_safe).toEqual({ enabled: true, threshold: 0.5 });
  });
});
