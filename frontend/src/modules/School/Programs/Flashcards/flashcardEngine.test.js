import { describe, expect, it } from 'vitest';
import { assignmentSatisfied, cardFace, learnPrompt, recallMatches, recallMatchesAny, resolvePolicy } from './flashcardEngine.js';

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
  it('derives progressive recall from the card pair, not a bank item', () => {
    expect(learnPrompt(card)).toMatchObject({ kind: 'recall', prompt: 'front', acceptedAnswers: ['back'] });
  });
  it('moves from recognition into tolerant typed recall', () => {
    expect(learnPrompt({ ...card, learn: { front_to_back: { acceptedAnswers: ['second face', 'back'] } } }))
      .toMatchObject({ kind: 'recall', acceptedAnswers: ['second face', 'back'] });
    expect(recallMatches('Back!', 'back')).toBe(true);
    expect(recallMatches('other', 'back')).toBe(false);
    expect(recallMatchesAny('Back!', ['other', 'back'])).toBe(true);
  });
});
