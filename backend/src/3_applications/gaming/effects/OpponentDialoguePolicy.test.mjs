import { describe, expect, it } from 'vitest';
import { normalizeOpponentDialogue } from './OpponentDialoguePolicy.mjs';

describe('OpponentDialoguePolicy', () => {
  it('keeps reusable safety, repetition, and authored lore boundaries game-neutral', () => {
    expect(normalizeOpponentDialogue('A bright answer!', {
      dialogue: [{ quip: 'A bright answer is coming.' }],
    })).toBeNull();
    const lore = { references: ['String Shot'], known_references: ['String Shot', 'Poison Sting'] };
    expect(normalizeOpponentDialogue('String Shot slows the moment.', { lore })).toBe('String Shot slows the moment.');
    expect(normalizeOpponentDialogue('Poison Sting surprises you.', { lore })).toBeNull();
  });

  it('lets each game supply private vocabulary that must never be shown', () => {
    expect(normalizeOpponentDialogue('The e4 pawn advances.', {
      forbiddenPatterns: [/\b[a-h][1-8]\b/i],
    })).toBeNull();
  });
});
