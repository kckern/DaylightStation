import { describe, expect, it } from 'vitest';
import { assignmentSatisfied, cardFace, learnPrompt, resolvePolicy } from './flashcardEngine.js';

describe('flashcard assignment policy', () => {
  it('requires each configured overlay target', () => {
    const policy = { activeMinutes: 10, minimumReviews: 8, masteryPercent: 80 };
    expect(assignmentSatisfied({ policy, progress: { activeSeconds: 600, reviews: 8, masteryPercent: 79 } })).toBe(false);
    expect(assignmentSatisfied({ policy, progress: { activeSeconds: 600, reviews: 8, masteryPercent: 80 } })).toBe(true);
  });
  it('defaults to all four non-game modes', () => expect(resolvePolicy({}).modes).toEqual(['review', 'learn', 'cards', 'test']));
});

describe('flashcard presentation helpers', () => {
  const card = { front: { blocks: [{ type: 'text', text: 'front' }] }, back: { blocks: [{ type: 'text', text: 'back' }] } };
  it('respects direction and reveal state', () => {
    expect(cardFace(card, 'front_to_back', false)).toBe(card.front);
    expect(cardFace(card, 'back_to_front', false)).toBe(card.back);
    expect(cardFace(card, 'back_to_front', true)).toBe(card.front);
  });
  it('uses an objective bank item for progressive recognition', () => {
    expect(learnPrompt(card, { id: 'x', prompt: 'Which?', choices: ['a', 'b'], answer: 'a' })).toMatchObject({ kind: 'choice', answer: 'a' });
  });
});
