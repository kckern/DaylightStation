import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, compatibilityScore, rankLayerCandidates } from './layerMatch.mjs';

// Minimal LoopEntry shapes (subset of index.yml fields the matcher reads).
const E = (over) => ({ slug: 'x', type: 'melody', mood: null, sources: ['niko-master'], bpm: null, roman: null, degrees: null, ...over });

describe('roleOf', () => {
  it('maps loop type to a layering role', () => {
    assert.equal(roleOf(E({ type: 'chord-progression' })), 'chords');
    assert.equal(roleOf(E({ type: 'melody' })), 'melody');
    assert.equal(roleOf(E({ type: 'bassline' })), 'bass');
  });
});

describe('compatibilityScore', () => {
  it('rewards role complement and penalizes doubling the same role', () => {
    const base = E({ type: 'chord-progression', slug: 'base' });
    const melody = E({ type: 'melody', slug: 'm' });
    const otherChords = E({ type: 'chord-progression', slug: 'c2' });
    assert.ok(compatibilityScore(base, melody) > compatibilityScore(base, otherChords));
  });
});

describe('rankLayerCandidates', () => {
  const base = E({ type: 'chord-progression', slug: 'base', mood: 'Catchy', sources: ['famous'], artist: 'Drake', bpm: 120, roman: ['I', 'V', 'vi', 'IV'] });

  it('excludes the base itself', () => {
    const ranked = rankLayerCandidates(base, [base, E({ slug: 'm', type: 'melody' })]);
    assert.ok(!ranked.some((r) => r.entry.slug === 'base'));
  });

  it('ranks a complementary role above the same role', () => {
    const ranked = rankLayerCandidates(base, [
      E({ slug: 'chords2', type: 'chord-progression' }),
      E({ slug: 'mel', type: 'melody' }),
    ]);
    assert.equal(ranked[0].entry.slug, 'mel');
  });

  it('prefers matching mood, all else equal', () => {
    const ranked = rankLayerCandidates(base, [
      E({ slug: 'dark', type: 'melody', mood: 'Dark', roman: ['I'] }),
      E({ slug: 'catchy', type: 'melody', mood: 'Catchy', roman: ['I'] }),
    ]);
    assert.equal(ranked[0].entry.slug, 'catchy');
  });

  it('prefers the closer BPM, all else equal', () => {
    const ranked = rankLayerCandidates(base, [
      E({ slug: 'far', type: 'melody', bpm: 170, roman: ['I'] }),
      E({ slug: 'near', type: 'melody', bpm: 122, roman: ['I'] }),
    ]);
    assert.equal(ranked[0].entry.slug, 'near');
  });

  it('can filter to a requested role', () => {
    const ranked = rankLayerCandidates(base, [
      E({ slug: 'mel', type: 'melody' }),
      E({ slug: 'bass', type: 'bassline' }),
    ], { role: 'bass' });
    assert.deepEqual(ranked.map((r) => r.entry.slug), ['bass']);
  });

  it('attaches a score and human reasons to each candidate', () => {
    const ranked = rankLayerCandidates(base, [E({ slug: 'mel', type: 'melody', mood: 'Catchy', roman: ['I'] })]);
    assert.equal(typeof ranked[0].score, 'number');
    assert.ok(Array.isArray(ranked[0].reasons) && ranked[0].reasons.length > 0);
  });
});
