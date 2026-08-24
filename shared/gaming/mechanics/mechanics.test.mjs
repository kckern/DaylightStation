import { describe, expect, it } from 'vitest';
import { diceRendererKind, parseDiceNotation, rollDice } from './dice.mjs';
import { selectSeeded } from './selection.mjs';

describe('gaming mechanics', () => {
  it('parses NdS±M and repeats outcomes for the same seed', () => {
    expect(parseDiceNotation('2d20+3')).toMatchObject({ count: 2, sides: 20, modifier: 3 });
    expect(rollDice('2d20+3', 42)).toEqual(rollDice('2d20+3', 42));
  });
  it('uses percentile dice and deterministic renderer fallbacks', () => {
    expect(diceRendererKind(100)).toBe('percentile-pair'); expect(diceRendererKind(37)).toBe('deterministic-2d'); expect(diceRendererKind(20, { webgl: false })).toBe('deterministic-2d');
  });
  it('selects household candidates deterministically', () => { expect(selectSeeded(['a', 'b', 'c'], 9)).toEqual(selectSeeded(['a', 'b', 'c'], 9)); });
});
