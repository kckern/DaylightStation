import { describe, it, expect } from 'vitest';
import { ghostPlacement } from './scoreWrongGhost.js';

const base = { fifths: 0, clef: 'G', half: 5, headWidth: 12 };

describe('ghostPlacement', () => {
  it('draws nothing for the owed pitch itself', () => {
    expect(ghostPlacement({ ...base, owedMidi: 60, wrongMidi: 60 })).toBeNull();
  });

  it('moves up one staff step per letter, in the same column a third or more away', () => {
    // Owed C4, played E4: two letters up, on the bottom line, no ledger.
    const g = ghostPlacement({ ...base, owedMidi: 60, wrongMidi: 64 });
    expect(g).toMatchObject({ steps: 2, dx: 0, dy: -10, alter: 0, position: 0, ledgerYs: [] });
  });

  it('puts a second beside the owed head, touching', () => {
    const g = ghostPlacement({ ...base, owedMidi: 64, wrongMidi: 62 });
    expect(g).toMatchObject({ steps: -1, dx: 12, dy: 5 });
  });

  it('spells a black key with its sharp and sits it beside a same-letter owed note', () => {
    const g = ghostPlacement({ ...base, owedMidi: 60, wrongMidi: 61 });
    expect(g).toMatchObject({ steps: 0, dx: 12, dy: -0, alter: 1 });
  });

  it('draws the ledger lines a low ghost needs, measured from the owed head', () => {
    // Owed E4 (bottom line, centre y 0). Played A3: position -4 → ledgers at -2 (C4) and -4 (A3).
    const g = ghostPlacement({ ...base, owedMidi: 64, wrongMidi: 57 });
    expect(g.position).toBe(-4);
    expect(g.ledgerYs).toEqual([10, 20]);
    expect(g.dy).toBe(20);
  });

  it('reads the bass clef from its own bottom line', () => {
    // Owed C3 in bass (position 3), played C4 → position 10: one ledger above the top line.
    const g = ghostPlacement({ ...base, clef: 'F', owedMidi: 48, wrongMidi: 60 });
    expect(g.position).toBe(10);
    expect(g.ledgerYs).toEqual([-35]);
  });
});
