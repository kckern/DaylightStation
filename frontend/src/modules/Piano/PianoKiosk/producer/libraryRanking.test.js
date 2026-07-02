/**
 * libraryRanking tests — the guardrail matrix + rank blend (Task 5.1).
 *
 * Timelines are REAL hand-built 4-slot fixtures using the consonance test
 * vocabulary (root-relative pc sets): I-I-V-I as the harmonic base, a
 * roots-only stack that unions clean over it, and a dim7 wall that unions
 * to 6+ pcs (nameable-chord max is 5) so it's dissonant on every slot.
 */
import { describe, it, expect } from 'vitest';
import { buildCompatibleSet, rankCompatible } from './libraryRanking.js';

// ── timeline fixtures (root-relative pc sets, consonance.test vocabulary) ────
const TL_I_V = [[0, 4, 7], [0, 4, 7], [2, 7, 11], [0, 4, 7]]; // I I V I
const TL_ROOTS = [[0], [0], [7], [0]]; // octaves-on-root: unions stay ⊆ maj/dom
const TL_DIM7 = [[0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9]]; // ∪ I = 6 pcs → clash
const TL_FIT_10 = [[4], [7], [11], [0]]; // every pc a chord tone over TL_I_V → fit 1.0
const TL_FIT_05 = [[4], [7], [1], [1]]; // 2 chord tones + 2 chromatic → fit 0.5

// ── entry factories (flat index-entry shape) ─────────────────────────────────
const harmonic = (slug, timeline, extra = {}) => ({
  slug,
  path: `chord-progressions/${slug}.mid`,
  type: 'chord-progression',
  roman: ['I', 'I', 'V', 'I'],
  ...(timeline ? { timeline, timelineRoot: 0, specificity: 'triad', rootSource: 'declared' } : {}),
  ...extra,
});
const bassline = (slug, timeline, extra = {}) => ({
  ...harmonic(slug, timeline, extra),
  path: `basslines/${slug}.mid`,
  type: 'bassline',
});
const melody = (slug, timeline, extra = {}) => ({
  slug,
  path: `melodies/${slug}.mid`,
  type: 'melody',
  degrees: [1, 2, 3],
  ...(timeline ? { timeline, timelineRoot: 0, specificity: 'triad' } : {}),
  ...extra,
});
const groove = (slug, extra = {}) => ({
  slug,
  path: `grooves/${slug}.mid`,
  type: 'groove',
  feel: 'straight',
  ...extra,
});

const BASE = harmonic('base-i-v', TL_I_V, { mood: 'Happy' });
const slugsOf = (results) => results.map((r) => r.entry.slug);

describe('buildCompatibleSet — guardrail matrix', () => {
  it('null base: every entry passes untouched (unfiltered browse)', () => {
    const entries = [
      harmonic('clean', TL_ROOTS),
      harmonic('unenriched', null),
      harmonic('flagged', TL_ROOTS, { needsReview: true }),
      melody('tune', TL_FIT_10),
      groove('rock'),
    ];
    const out = buildCompatibleSet({ entries, baseEntry: null });
    expect(slugsOf(out)).toEqual(['clean', 'unenriched', 'flagged', 'tune', 'rock']);
    expect(out.every((r) => r.stackable === true)).toBe(true);
  });

  it('harmonic base: stackable harmonic candidate passes', () => {
    const out = buildCompatibleSet({ entries: [harmonic('roots', TL_ROOTS)], baseEntry: BASE });
    expect(slugsOf(out)).toEqual(['roots']);
    expect(out[0].stackable).toBe(true);
  });

  it('harmonic base: dissonant harmonic candidate is excluded', () => {
    const out = buildCompatibleSet({ entries: [harmonic('dim-wall', TL_DIM7)], baseEntry: BASE });
    expect(out).toEqual([]);
  });

  it('harmonic base: bassline candidates gate exactly like harmonic ones', () => {
    const out = buildCompatibleSet({
      entries: [bassline('good-bass', TL_ROOTS), bassline('bad-bass', TL_DIM7)],
      baseEntry: BASE,
    });
    expect(slugsOf(out)).toEqual(['good-bass']);
  });

  it('harmonic base: candidate WITHOUT a timeline is excluded before stackable runs (no throw)', () => {
    const out = buildCompatibleSet({ entries: [harmonic('unenriched', null)], baseEntry: BASE });
    expect(out).toEqual([]);
  });

  it('harmonic base: needsReview candidate is excluded even if it has a timeline', () => {
    const out = buildCompatibleSet({
      entries: [harmonic('flagged', TL_ROOTS, { needsReview: true })],
      baseEntry: BASE,
    });
    expect(out).toEqual([]);
  });

  it('harmonic base: grooves ALWAYS pass (no timeline needed)', () => {
    const out = buildCompatibleSet({ entries: [groove('rock')], baseEntry: BASE });
    expect(slugsOf(out)).toEqual(['rock']);
    expect(out[0].stackable).toBe(true);
  });

  it('harmonic base: melodic candidates pass tagged with fit (ranked, not gated)', () => {
    const out = buildCompatibleSet({
      entries: [melody('perfect', TL_FIT_10), melody('half', TL_FIT_05)],
      baseEntry: BASE,
    });
    expect(slugsOf(out)).toEqual(['perfect', 'half']);
    expect(out[0].fit).toBe(1);
    expect(out[1].fit).toBe(0.5);
  });

  it('harmonic base: idea entries take the melodic path (fit-tagged, never gated)', () => {
    const idea = { ...melody('spark', TL_FIT_05), type: 'idea', path: 'ideas/spark.mid' };
    const out = buildCompatibleSet({ entries: [idea], baseEntry: BASE });
    expect(slugsOf(out)).toEqual(['spark']);
    expect(out[0].fit).toBe(0.5);
  });

  it('harmonic base: melodic candidate without a timeline / flagged is excluded', () => {
    const out = buildCompatibleSet({
      entries: [melody('unenriched', null), melody('flagged', TL_FIT_10, { needsReview: true })],
      baseEntry: BASE,
    });
    expect(out).toEqual([]);
  });

  it('the base entry itself never appears in its own compatible set', () => {
    const out = buildCompatibleSet({ entries: [BASE, harmonic('roots', TL_ROOTS)], baseEntry: BASE });
    expect(slugsOf(out)).toEqual(['roots']);
  });

  it('groove base: everything passes (grooves are neutral)', () => {
    const entries = [harmonic('dim-wall', TL_DIM7), harmonic('unenriched', null), melody('tune', TL_FIT_10)];
    const out = buildCompatibleSet({ entries, baseEntry: groove('rock') });
    expect(slugsOf(out)).toEqual(['dim-wall', 'unenriched', 'tune']);
  });

  it('unenriched harmonic base: no timeline to gate on → unfiltered (documented fallback)', () => {
    const entries = [harmonic('dim-wall', TL_DIM7), groove('rock')];
    const out = buildCompatibleSet({ entries, baseEntry: harmonic('no-tl-base', null) });
    expect(slugsOf(out)).toEqual(['dim-wall', 'rock']);
  });
});

describe('rankCompatible — layerMatch scoring + fit blend', () => {
  it('null base: returns results unchanged (nothing to score against)', () => {
    const results = buildCompatibleSet({ entries: [groove('a'), groove('b')], baseEntry: null });
    expect(rankCompatible(results, null)).toBe(results);
  });

  it('attaches layerMatch score + human reasons to every result', () => {
    const results = buildCompatibleSet({
      entries: [harmonic('same-mood', TL_ROOTS, { mood: 'Happy' })],
      baseEntry: BASE,
    });
    const ranked = rankCompatible(results, BASE);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].reasons).toContain('Happy mood');
  });

  it('BLEND: a 1.0-fit melody outranks a 0.5-fit melody with a better mood match', () => {
    // fit05 gets the base's mood (+2 layerMatch); fit10 doesn't. The fit
    // weight (×5) must still put the perfect-fit melody first: 3+5 > 5+2.5.
    const results = buildCompatibleSet({
      entries: [melody('fit05', TL_FIT_05, { mood: 'Happy' }), melody('fit10', TL_FIT_10)],
      baseEntry: BASE,
    });
    const ranked = rankCompatible(results, BASE);
    expect(slugsOf(ranked)).toEqual(['fit10', 'fit05']);
  });

  it('keeps the consonance stackable flag (never overwritten by legacy roman matching)', () => {
    // Candidate shares no roman signature with base, but unions clean —
    // legacy areStackable would say false; our flag must stay true.
    const cand = harmonic('other-roman', TL_ROOTS, { roman: ['I', 'IV'] });
    const ranked = rankCompatible(buildCompatibleSet({ entries: [cand], baseEntry: BASE }), BASE);
    expect(ranked[0].stackable).toBe(true);
  });

  it('ranks stackable harmonics by layerMatch score (mood match wins the tiebreak)', () => {
    const results = buildCompatibleSet({
      entries: [harmonic('plain', TL_ROOTS, { mood: 'Sad' }), harmonic('matching', TL_ROOTS, { mood: 'Happy' })],
      baseEntry: BASE,
    });
    expect(slugsOf(rankCompatible(results, BASE))).toEqual(['matching', 'plain']);
  });
});
