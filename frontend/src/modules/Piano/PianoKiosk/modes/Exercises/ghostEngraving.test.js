import { describe, expect, it } from 'vitest';
import { placeGhosts, stemDirection } from './ghostEngraving.js';

// Staff: bottom line at y=100, spacing 14 -> one step (position unit) = 7.
// Position 0 = bottom line (E4), 4 = middle line (B4), 8 = top line (F5).
const SPACING = 14;
const BOTTOM = 100;
const RX = 9;
const yOf = (pos) => BOTTOM - pos * SPACING / 2;
const base = { bottom: BOTTOM, spacing: SPACING, rx: RX, scale: 1, accidentalWidth: 11, accidentalGap: 3, ledgerReach: 5 };

// Stem-down quarter on B4 (pos 4): stem at the head's LEFT edge, hanging down.
const downStem = { x: 50, top: yOf(4), bottom: yOf(4) + 3.5 * SPACING, dir: 'down' };
const downTarget = { heads: [{ position: 4, cx: 50 + RX }], stem: downStem };
// Stem-up quarter on B4: stem at the head's RIGHT edge, rising.
const upStem = { x: 50, top: yOf(4) - 3.5 * SPACING, bottom: yOf(4), dir: 'up' };
const upTarget = { heads: [{ position: 4, cx: 50 - RX }], stem: upStem };

const ghost = (position, extra = {}) => ({ midi: 60 + position, position, ...extra });
const one = (target, g) => placeGhosts({ ...base, ...target, ghosts: [g] }).ghosts[0];

describe('stemDirection', () => {
  it('reads down when the stem hangs below the head, up when it rises', () => {
    expect(stemDirection({ top: 80, bottom: 120 }, [80])).toBe('down');
    expect(stemDirection({ top: 40, bottom: 80 }, [80])).toBe('up');
  });
  it('is none without a stem', () => {
    expect(stemDirection(null, [80])).toBe('none');
  });
});

describe('placeGhosts: a second', () => {
  it('stem-down: the LOWER head (A4 under B4) goes LEFT of the stem, touching it', () => {
    const g = one(downTarget, ghost(3));
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(50 - RX);
    expect(g.cy).toBe(yOf(3));
    // touching: the head's right edge is the stem
    expect(g.cx + RX).toBe(downStem.x);
    expect(g.stemSegment).toBeNull();
  });
  it('stem-down: an UPPER neighbour (C5) cannot share the normal side with the target head, so it flips too', () => {
    // Engraving would flip the target; the target is abcjs's and fixed, so the
    // ghost takes the free side rather than overprinting it.
    const g = one(downTarget, ghost(5));
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(50 - RX);
  });
  it('stem-up: the UPPER head (C5 over B4) goes RIGHT of the stem, touching it', () => {
    const g = one(upTarget, ghost(5));
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(50 + RX);
    expect(g.cx - RX).toBe(upStem.x);
  });
  it('stem-up: a LOWER neighbour flips too (the target head is fixed)', () => {
    const g = one(upTarget, ghost(3));
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(50 + RX);
  });
});

describe('placeGhosts: a third or more', () => {
  it('shares the target head side and x (stem-down: right of the stem)', () => {
    const g = one(downTarget, ghost(2));
    expect(g.flipped).toBe(false);
    expect(g.cx).toBe(50 + RX);
    expect(g.cy).toBe(yOf(2));
  });
  it('shares the target head side (stem-up: left of the stem)', () => {
    expect(one(upTarget, ghost(6)).cx).toBe(50 - RX);
  });
  it('inside the stem span needs no extra stem', () => {
    expect(one(downTarget, ghost(2)).stemSegment).toBeNull();
  });
  it('below a stem-down stem tip: a short stem joins the head to the stem end', () => {
    const g = one(downTarget, ghost(-6));
    expect(g.stemSegment).toMatchObject({ x: 50, y1: downStem.bottom, y2: yOf(-6) });
  });
  it('above a stem-down note (stem starts at the head): stem runs up to the ghost', () => {
    const g = one(downTarget, ghost(9));
    expect(g.stemSegment).toMatchObject({ x: 50, y1: yOf(9), y2: downStem.top });
  });
  it('above a stem-up stem tip: joins tip to head', () => {
    const g = one(upTarget, ghost(12));
    expect(g.stemSegment).toMatchObject({ x: 50, y1: yOf(12), y2: upStem.top });
  });
  it('below a stem-up note: stem runs down to the ghost', () => {
    const g = one(upTarget, ghost(-2));
    expect(g.stemSegment).toMatchObject({ x: 50, y1: upStem.bottom, y2: yOf(-2) });
  });
});

describe('placeGhosts: a stem with width', () => {
  it('a flipped head is flush against the bar\'s far edge, not its centre', () => {
    const stem = { ...downStem, halfWidth: 0.5 };
    const g = one({ heads: [{ position: 4, cx: 49.5 + RX }], stem }, ghost(3));
    expect(g.cx + RX).toBe(50.5);
  });
  it('the normal side is flush against the near edge', () => {
    const stem = { ...downStem, halfWidth: 0.5 };
    expect(one({ heads: [{ position: 4, cx: 49.5 + RX }], stem }, ghost(2)).cx).toBe(49.5 + RX);
  });
});

describe('placeGhosts: no stem (whole note)', () => {
  const whole = { heads: [{ position: 4, cx: 60 }], stem: null };
  it('a third shares the head column and draws no stem segment', () => {
    const g = one(whole, ghost(2));
    expect(g.cx).toBe(60);
    expect(g.stemSegment).toBeNull();
  });
  it('a second puts the lower head left of the column, touching', () => {
    const g = one(whole, ghost(3));
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(60 - 2 * RX);
    expect(g.stemSegment).toBeNull();
  });
  it('the upper neighbour of a whole note goes right of the column, touching', () => {
    expect(one(whole, ghost(5)).cx).toBe(60 + 2 * RX);
  });
});

describe('placeGhosts: unison', () => {
  it('the same midi draws nothing', () => {
    const r = placeGhosts({ ...base, ...downTarget, ghosts: [{ midi: 71, position: 4 }], targetMidis: [71] });
    expect(r.ghosts).toEqual([]);
  });
  it('the same line with another accidental sits beside the head, flipped', () => {
    const g = one(downTarget, { midi: 70, position: 4, isFlat: true });
    expect(g.flipped).toBe(true);
    expect(g.cx).toBe(50 - RX);
  });
});

describe('placeGhosts: accidental slot', () => {
  it('sits left of the ghost head, clear of it', () => {
    const g = one(downTarget, ghost(2, { isSharp: true }));
    const headLeft = g.cx - RX;
    expect(g.accX).toBe(headLeft - 3 - 11 / 2);
  });
  it('sits left of a flipped head, not left of the column', () => {
    const g = one(downTarget, ghost(3, { isFlat: true }));
    expect(g.accX).toBe((50 - 2 * RX) - 3 - 11 / 2);
  });
  it('is null without an accidental', () => {
    expect(one(downTarget, ghost(2)).accX).toBeNull();
  });
});

describe('placeGhosts: ledger lines', () => {
  it('draws one at the ghost position, reaching past the head', () => {
    const g = one(downTarget, ghost(-2));
    expect(g.ledgers).toEqual([{ x1: 50 + RX - RX - 5, x2: 50 + RX + RX + 5, y: yOf(-2) }]);
  });
  it('spans both heads when the ghost sits beside the target', () => {
    // C4 (pos -2) target, stem-up; B3 (pos -3) pressed, flipped second.
    const stem = { x: 50, top: yOf(-2) - 3.5 * SPACING, bottom: yOf(-2), dir: 'up' };
    const target = { heads: [{ position: -2, cx: 50 - RX }], stem };
    // pos -1 is above C4: it needs no ledger line of its own
    expect(one(target, ghost(-1, { midi: 61 })).ledgers).toEqual([]);
    const h = one({ heads: [{ position: 10, cx: 50 - RX }], stem: { ...stem, top: yOf(10) - 49, bottom: yOf(10) } }, ghost(11));
    // A5-ish second above a ledger-line head: ghost at 11 needs the line at 10, spanning both heads
    expect(h.ledgers).toEqual([{ x1: 50 - RX - RX - 5, x2: 50 + RX + RX + 5, y: yOf(10) }]);
  });
});

describe('placeGhosts: several ghosts and the lane', () => {
  it('two adjacent ghosts do not collide: the second is flipped against the first', () => {
    const r = placeGhosts({ ...base, ...downTarget, ghosts: [ghost(1), ghost(2)] });
    const byPos = Object.fromEntries(r.ghosts.map(g => [g.position, g]));
    expect(byPos[2].flipped).toBe(false);
    expect(byPos[1].flipped).toBe(true);
    expect(byPos[1].cx).not.toBe(byPos[2].cx);
  });
  it('reports the horizontal extent of every drawn head and accidental', () => {
    const r = placeGhosts({ ...base, ...downTarget, ghosts: [ghost(3, { isSharp: true })] });
    expect(r.minX).toBe((50 - 2 * RX) - 3 - 11);
    expect(r.maxX).toBe(50);
  });
  it('has no extent when nothing is drawn', () => {
    const r = placeGhosts({ ...base, ...downTarget, ghosts: [] });
    expect(r.ghosts).toEqual([]);
    expect(r.minX).toBeNull();
  });
});
