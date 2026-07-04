import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, compatibilityScore, rankLayerCandidates } from './layerMatch.mjs';

// Minimal brick shapes (subset of index.yml fields the matcher reads).
const E = (over) => ({ slug: 'x', type: 'melody', emotion: [], genre: ['niko-master'], bpm: null, roman: null, degrees: null, ...over });

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
  const base = E({ type: 'chord-progression', slug: 'base', emotion: ['catchy'], genre: ['famous'], artist: 'Drake', bpm: 120, roman: ['I', 'V', 'vi', 'IV'] });

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

  it('prefers matching emotion, all else equal', () => {
    const ranked = rankLayerCandidates(base, [
      E({ slug: 'dark', type: 'melody', emotion: ['dark'], roman: ['I'] }),
      E({ slug: 'catchy', type: 'melody', emotion: ['catchy'], roman: ['I'] }),
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
    const ranked = rankLayerCandidates(base, [E({ slug: 'mel', type: 'melody', emotion: ['catchy'], roman: ['I'] })]);
    assert.equal(typeof ranked[0].score, 'number');
    assert.ok(Array.isArray(ranked[0].reasons) && ranked[0].reasons.length > 0);
  });
});

describe('harmonic gating', () => {
  const base = { slug: 'base', type: 'chord-progression', roman: ['I', 'V', 'vi', 'IV'], emotion: ['catchy'], genre: ['p'] };
  const sameSig = { slug: 'm1', type: 'melody', roman: ['I', 'I', 'V', 'V', 'vi', 'vi', 'IV', 'IV'], emotion: ['sad'], genre: ['q'] };
  const diffSig = { slug: 'm2', type: 'melody', roman: ['ii', 'V', 'I'], emotion: ['catchy'], genre: ['p'] };

  it('scores a same-signature candidate above a same-emotion/same-genre different-signature one', () => {
    assert.ok(compatibilityScore(base, sameSig) > compatibilityScore(base, diffSig));
  });
  it('rankLayerCandidates with {onlyStackable:true} drops different-signature candidates', () => {
    const ranked = rankLayerCandidates(base, [sameSig, diffSig], { onlyStackable: true });
    assert.deepEqual(ranked.map((r) => r.entry.slug), ['m1']);
  });
  it('tags "same progression" as the lead reason', () => {
    const ranked = rankLayerCandidates(base, [sameSig]);
    assert.equal(ranked[0].reasons[0], 'same progression');
  });
});

describe('layerMatch (brick fields)', () => {
  it('maps groove type to the groove role', () => {
    assert.equal(roleOf({ type: 'groove' }), 'groove');
    assert.equal(roleOf({ type: 'chord-progression' }), 'chords');
    assert.equal(roleOf({ type: 'bassline' }), 'bass');
  });

  it('rewards shared emotion and genre, and complementary roles', () => {
    const base = { type: 'chord-progression', roman: ['I', 'V'], emotion: ['dreamy'], genre: ['lofi'] };
    const shares = { type: 'melody', roman: [], emotion: ['dreamy'], genre: ['lofi'] };
    const differs = { type: 'melody', roman: [], emotion: ['dark'], genre: ['edm'] };
    assert.ok(compatibilityScore(base, shares) > compatibilityScore(base, differs));
  });

  it('ranks candidates best-first and excludes the base itself', () => {
    const base = { path: 'chords/x.musicxml', type: 'chord-progression', roman: ['I'], emotion: ['dreamy'], genre: ['lofi'] };
    const cands = [base, { path: 'melodies/y.musicxml', type: 'melody', roman: [], emotion: ['dreamy'], genre: ['lofi'] }];
    const ranked = rankLayerCandidates(base, cands);
    assert.deepEqual(ranked.map((r) => r.entry.path), ['melodies/y.musicxml']);
  });
});
