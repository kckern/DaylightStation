import { describe, expect, it } from 'vitest';
import {
  resolveAddressing, normalizeAddressing, activeRung, materialFor, raiseTierToFit,
} from './resolveAddressing.js';
import { buildScheme, schemeFor } from './buildScheme.js';
import { ADDRESSING_RUNGS, MAX_RUNG } from './dimensions.js';

describe('resolveAddressing — the layers', () => {
  it('falls back to the house default when nothing is configured', () => {
    const resolved = resolveAddressing();
    expect(resolved).toMatchObject({
      vocabulary: 'staff', clefs: 'grand', shuffle: 'never',
      x: { tier: 2, order: 'sequential' }, y: { tier: 2, order: 'sequential' },
    });
  });

  it('lets a game override the house', () => {
    const resolved = resolveAddressing({ game: { vocabulary: 'chords' } });
    expect(resolved.vocabulary).toBe('chords');
    expect(resolved.clefs).toBe('grand'); // untouched dimensions survive
  });

  it('lets a rung override the game', () => {
    const resolved = resolveAddressing({ game: { vocabulary: 'chords' }, rung: 2 });
    expect(resolved.vocabulary).toBe('staff');
    expect(resolved.clefs).toBe('treble-only');
  });

  it('lets a player override the rung', () => {
    const rung = ADDRESSING_RUNGS.find((entry) => entry.rung === 7);
    const resolved = resolveAddressing({ rung: 7, user: { shuffle: 'never' } });
    expect(resolved.shuffle).toBe('never');
    // ...without losing the rest of the rung.
    expect(resolved.x.tier).toBe(rung.x.tier);
    expect(resolved.x.order).toBe(rung.x.order);
  });

  it('overrides ONE dimension without collapsing its siblings', () => {
    // The requirement in one test: a player who states a single dimension keeps
    // every other dimension from the layers beneath.
    const resolved = resolveAddressing({
      game: { vocabulary: 'chords', shuffle: 'each_game', inversions: 'root', x: { tier: 3, order: 'shuffled' }, y: { tier: 4 } },
      user: { x: { tier: 5 } },
    });
    expect(resolved.vocabulary).toBe('chords');
    expect(resolved.shuffle).toBe('each_game');
    expect(resolved.inversions).toBe('root');
    expect(resolved.x).toEqual({ tier: 5, order: 'shuffled' });  // tier replaced, order kept
    expect(resolved.y).toEqual({ tier: 4, order: 'sequential' });
  });

  it('keeps the two axes independent', () => {
    const resolved = resolveAddressing({ game: { x: { order: 'shuffled' }, y: { order: 'sequential' } } });
    expect(resolved.x.order).toBe('shuffled');
    expect(resolved.y.order).toBe('sequential');
  });
});

describe('resolveAddressing — bad input', () => {
  it('drops an unknown value and says why, instead of passing it through', () => {
    const resolved = resolveAddressing({ game: { vocabulary: 'staves' } });
    expect(resolved.vocabulary).toBe('staff');
    expect(resolved.notes.join(' ')).toMatch(/vocabulary "staves"/);
  });

  it('drops an out-of-range tier', () => {
    const resolved = resolveAddressing({ game: { x: { tier: 99 } } });
    expect(resolved.x.tier).toBe(2);
    expect(resolved.notes.join(' ')).toMatch(/x\.tier 99/);
  });

  it('raises a tier whose pool cannot fill the axis, rather than dealing it short', () => {
    // Tier 0 is a five-finger position; an 8-wide axis would leave three files
    // no key can ever address, which looks exactly like a broken game.
    const resolved = resolveAddressing({ game: { x: { tier: 0 }, y: { tier: 0 } }, axisSize: 8 });
    expect(resolved.x.tier).toBeGreaterThan(0);
    expect(resolved.notes.join(' ')).toMatch(/too few notes/);
  });

  it('leaves a small tier alone when the axis is small enough for it', () => {
    const resolved = resolveAddressing({ game: { x: { tier: 0 }, y: { tier: 0 } }, axisSize: 5 });
    expect(resolved.x.tier).toBe(0);
  });
});

describe('normalizeAddressing — canonical config shape', () => {
  it('reads a nested addressing block', () => {
    const out = normalizeAddressing({ addressing: { vocabulary: 'chords', x: { tier: 4 } } });
    expect(out).toMatchObject({ vocabulary: 'chords', x: { tier: 4 } });
  });

  it('rejects a scalar block instead of guessing', () => {
    expect(normalizeAddressing('staff')).toEqual({});
    expect(normalizeAddressing({ addressing: 'chords' })).toEqual({});
  });

  it('survives null, undefined and nonsense', () => {
    expect(normalizeAddressing(null)).toEqual({});
    expect(normalizeAddressing(undefined)).toEqual({});
    expect(normalizeAddressing(7)).toEqual({});
  });
});

describe('activeRung', () => {
  it('uses what the player has earned', () => {
    expect(activeRung({ unlocked_through: 4 })).toBe(4);
  });

  it('lets a pin beat the earned rung — the "hold this player still" case', () => {
    expect(activeRung({ unlocked_through: 9, pinned: 3 })).toBe(3);
  });

  it('clamps a rung outside the ladder rather than resolving to nothing', () => {
    expect(activeRung({ unlocked_through: 99 })).toBe(MAX_RUNG);
    expect(activeRung({ unlocked_through: -3 })).toBe(1);
  });

  it('has no opinion when there is no ladder', () => {
    expect(activeRung(null)).toBeNull();
  });
});

describe('the ladder rungs', () => {
  it('every rung resolves to a valid, buildable scheme', () => {
    for (const entry of ADDRESSING_RUNGS) {
      const resolved = resolveAddressing({ rung: entry.rung });
      const built = buildScheme(resolved, { size: 8, seed: 7 });
      expect(built.valid, `rung ${entry.rung} (${entry.label}): ${built.errors.join('; ')}`).toBe(true);
      expect(built.scheme.roots).toHaveLength(8);
      expect(built.scheme.qualities).toHaveLength(8);
    }
  });

  it('climbs: later rungs are never easier on cadence than earlier ones within a vocabulary', () => {
    const rank = { never: 0, each_game: 1, each_turn: 2 };
    for (const vocabulary of ['staff', 'chords']) {
      const cadences = ADDRESSING_RUNGS
        .filter((entry) => entry.vocabulary === vocabulary)
        .map((entry) => rank[entry.shuffle]);
      expect([...cadences].sort((a, b) => a - b)).toEqual(cadences);
    }
  });
});

describe('materialFor / raiseTierToFit', () => {
  it('gives each axis its own material', () => {
    expect(materialFor('staff', 'x', 2)).not.toEqual(materialFor('staff', 'y', 2));
    expect(materialFor('chords', 'y', 2)).toContain('major');
  });

  it('finds the lowest tier that fills the axis', () => {
    expect(raiseTierToFit('staff', 0, 8)).toBe(1);
    expect(raiseTierToFit('chords', 0, 8)).toBe(2);
    expect(raiseTierToFit('staff', 3, 8)).toBe(3);
  });
});

describe('buildScheme', () => {
  it('is deterministic for a seed, so a game replays identically', () => {
    const resolved = resolveAddressing({ game: { x: { order: 'shuffled' }, y: { order: 'shuffled' } } });
    const a = buildScheme(resolved, { seed: 42 });
    const b = buildScheme(resolved, { seed: 42 });
    expect(a.scheme).toEqual(b.scheme);
  });

  it('moves the axes independently, so one deal does not preserve their relationship', () => {
    const resolved = resolveAddressing({
      game: { vocabulary: 'chords', x: { order: 'shuffled' }, y: { order: 'shuffled' } },
    });
    const { scheme } = buildScheme(resolved, { seed: 3 });
    const sequential = buildScheme(resolveAddressing({ game: { vocabulary: 'chords' } }), { seed: 3 }).scheme;
    expect(scheme.roots).not.toEqual(sequential.roots);
    expect(scheme.qualities).not.toEqual(sequential.qualities);
    // Same vocabulary, different places — that is the whole point of a re-deal.
    expect([...scheme.roots].sort()).toEqual([...sequential.roots].sort());
  });

  it('keeps a sequential scheme id stable across seeds — nothing moved, so nothing re-dealt', () => {
    const resolved = resolveAddressing();
    expect(buildScheme(resolved, { seed: 1 }).scheme.id).toBe(buildScheme(resolved, { seed: 2 }).scheme.id);
  });

  it('changes the id when a shuffled scheme is re-dealt', () => {
    const resolved = resolveAddressing({ game: { x: { order: 'shuffled' } } });
    expect(buildScheme(resolved, { seed: 1 }).scheme.id).not.toBe(buildScheme(resolved, { seed: 2 }).scheme.id);
  });

  it('sizes an axis to the board it is addressing', () => {
    const { scheme } = buildScheme(resolveAddressing({ axisSize: 7 }), { size: 7 });
    expect(scheme.roots).toHaveLength(7);
  });
});

describe('schemeFor — the escape hatch', () => {
  it('takes an explicit valid scheme over anything the dimensions would build', () => {
    const explicit = { id: 'mine', kind: 'staff', roots: [60, 62, 64, 65, 67, 69, 71, 72], qualities: [47, 48, 50, 52, 53, 55, 57, 59] };
    const out = schemeFor({ vocabulary: 'staff', scheme: explicit });
    expect(out.source).toBe('explicit');
    expect(out.scheme).toBe(explicit);
  });

  it('REFUSES an invalid explicit scheme rather than half-applying it', () => {
    const broken = { id: 'broken', roots: ['C', 'C', 'C'], qualities: ['major'] };
    const out = schemeFor({ vocabulary: 'chords', scheme: broken });
    expect(out.valid).toBe(false);
    expect(out.source).toBe('rejected-explicit');
    expect(out.errors.length).toBeGreaterThan(0);
    // ...and still hands back something playable.
    expect(out.scheme.roots.length).toBeGreaterThan(0);
  });

  it('builds from the dimensions when no scheme is given', () => {
    expect(schemeFor(resolveAddressing()).source).toBe('built');
  });
});


describe('order: reverse', () => {
  it('is a first-class ordering, not a shuffle', () => {
    const resolved = resolveAddressing({ game: { x: { order: 'reverse' } } });
    expect(resolved.x.order).toBe('reverse');
  });

  it('reads the same scale downward — same notes, opposite direction', () => {
    const forward = buildScheme(resolveAddressing(), { seed: 1 }).scheme;
    const backward = buildScheme(resolveAddressing({ game: { x: { order: 'reverse' } } }), { seed: 1 }).scheme;
    expect(backward.roots).toEqual([...forward.roots].reverse());
    // The other axis is untouched: reverse is per-axis like every other knob.
    expect(backward.qualities).toEqual(forward.qualities);
  });

  it('does not depend on the seed — nothing random happened', () => {
    const a = buildScheme(resolveAddressing({ game: { x: { order: 'reverse' } } }), { seed: 1 }).scheme;
    const b = buildScheme(resolveAddressing({ game: { x: { order: 'reverse' } } }), { seed: 999 }).scheme;
    expect(a).toEqual(b);
  });

  it('builds a valid scheme in both vocabularies', () => {
    for (const vocabulary of ['staff', 'chords']) {
      const resolved = resolveAddressing({ game: { vocabulary, x: { order: 'reverse' }, y: { order: 'reverse' } } });
      expect(buildScheme(resolved).valid, vocabulary).toBe(true);
    }
  });
});

describe('inversions', () => {
  it('defaults to any — the shipped behaviour, where voicing is free', () => {
    expect(resolveAddressing().inversions).toBe('any');
  });

  it('is configurable at every layer', () => {
    expect(resolveAddressing({ game: { vocabulary: 'chords', inversions: 'root' } }).inversions).toBe('root');
    expect(resolveAddressing({
      game: { vocabulary: 'chords', inversions: 'root' }, user: { inversions: 'named' },
    }).inversions).toBe('named');
  });

  it('rejects a value that is not an inversion policy', () => {
    const resolved = resolveAddressing({ game: { vocabulary: 'chords', inversions: 'second' } });
    expect(resolved.inversions).toBe('any');
    expect(resolved.notes.join(' ')).toMatch(/inversions "second"/);
  });

  it('has no meaning for a staff address, and says so rather than pretending', () => {
    // Two notes played together have no inversion to have an opinion about.
    const resolved = resolveAddressing({ game: { vocabulary: 'staff', inversions: 'named' } });
    expect(resolved.inversions).toBe('any');
    expect(resolved.notes.join(' ')).toMatch(/no meaning for the staff vocabulary/);
    // ...but the player's setting survives, so switching back to chords restores it.
    expect(resolved.configured.inversions).toBe('named');
  });

  it('rides on the chord scheme, so the game can enforce it', () => {
    const resolved = resolveAddressing({ game: { vocabulary: 'chords', inversions: 'named' } });
    expect(buildScheme(resolved).scheme.inversions).toBe('named');
  });

  it('changes the scheme identity, so a rung change is not mistaken for the same board', () => {
    const any = buildScheme(resolveAddressing({ game: { vocabulary: 'chords' } })).scheme.id;
    const named = buildScheme(resolveAddressing({ game: { vocabulary: 'chords', inversions: 'named' } })).scheme.id;
    expect(named).not.toBe(any);
  });
});
