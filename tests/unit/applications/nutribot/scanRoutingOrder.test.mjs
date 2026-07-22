/**
 * Three-way scan routing contract.
 *
 * The barcode relay's `onScan` lives inside `app.mjs` (a composition root), so
 * the branch itself is not unit-testable without a refactor that is out of
 * scope. What IS testable — and what the branch actually depends on — is the
 * `handled` flag this use case returns. These tests pin that contract:
 * anything the fridge grammar claims must report `handled: true` so the caller
 * returns, and anything it does not claim must report `handled: false` so the
 * caller falls through to the existing UPC path unchanged.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';

const CONFIG = {
  densityLevels: [
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } },
  ],
  containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
};

const SCALE = 'kitchen';

describe('scan routing order (namespace-first, UPC fallthrough)', () => {
  let apply;

  beforeEach(() => {
    apply = new ApplyScanToComposition({
      store: new CompositionStore({ now: () => 1_000 }),
      config: CONFIG,
    });
  });

  // UPC/EAN are digit-only, so they can never take the `<prefix>:<rest>` shape
  // the grammar matches. This is why running parseScan first is safe.
  it.each([
    ['UPC-A', '012345678905'],
    ['EAN-13', '4006381333931'],
    ['UPC-E', '01234565'],
  ])('declines a %s barcode so the UPC path still runs', (_label, code) => {
    expect(apply.execute({ scaleId: SCALE, code })).toEqual({ handled: false });
  });

  it.each([
    ['density', 'dl:4'],
    ['container', 'ct:mug'],
    ['reset', 'rs:clear'],
  ])('claims a %s scan', (_kind, code) => {
    expect(apply.execute({ scaleId: SCALE, code }).handled).toBe(true);
  });

  // The subtle one. A refusal is still a claim: `ct:unknown` is unmistakably a
  // fridge-sheet code, so it must NOT fall through and be looked up as a
  // product UPC — that would return a nonsense food for a typo'd container.
  // This is why the caller branches on `handled`, never on `ok`.
  it('claims a refused container instead of falling through to a bogus UPC lookup', () => {
    const outcome = apply.execute({ scaleId: SCALE, code: 'ct:unknown' });
    expect(outcome.handled).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('UNKNOWN_CONTAINER');
  });

  it('claims a refused density level for the same reason', () => {
    const outcome = apply.execute({ scaleId: SCALE, code: 'dl:9' });
    expect(outcome.handled).toBe(true);
    expect(outcome.ok).toBe(false);
  });
});
