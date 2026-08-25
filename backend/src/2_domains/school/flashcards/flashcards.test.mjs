import { describe, expect, it } from 'vitest';
import { projectBankAsFlashcardDeck, validateFlashcardDeck } from './flashcardDeck.mjs';
import { selectReviewCards } from './reviewScheduler.mjs';
import { validateFlashcardEnrollment } from './flashcardEnrollment.mjs';

const deck = () => ({
  schema: 'school.flashcard-deck/v1', id: 'science/cells/organelles', title: 'Cell organelles',
  cards: [{ cardId: 'mitochondrion', front: { blocks: [{ type: 'text', text: 'Energy?' }, { type: 'image', assetId: 'mito', alt: 'Mitochondrion' }] }, back: { blocks: [{ type: 'text', text: 'Mitochondrion' }, { type: 'audio', assetId: 'say-mito', transcript: 'mitochondrion' }] } }],
});

describe('flashcard decks', () => {
  it('accepts accessible rich faces', () => expect(validateFlashcardDeck(deck()).errors).toEqual([]));
  it('keeps deck associations independent from its optional assessment', () => {
    const associative = deck();
    associative.assessment = { bankId: 'science/cells/check' };
    associative.cards[0] = {
      cardId: 'mitochondrion',
      front: { blocks: [{ type: 'text', text: 'Mitochondrion' }] },
      back: { blocks: [{ type: 'text', text: 'ATP production' }] },
      learn: { front_to_back: { acceptedAnswers: ['ATP production', 'energy production'] } },
    };
    const result = validateFlashcardDeck(associative);
    expect(result.errors).toEqual([]);
    expect(result.deck).toMatchObject({ assessment: { bankId: 'science/cells/check' }, cards: [{ cardId: 'mitochondrion' }] });
    expect(result.deck).not.toHaveProperty('bankId');
  });
  it('normalizes a legacy top-level bank id into deck assessment metadata', () => {
    const legacy = deck(); legacy.bankId = 'science/cells/check';
    expect(validateFlashcardDeck(legacy).deck).toMatchObject({ assessment: { bankId: 'science/cells/check' } });
  });
  it('refuses inaccessible media and duplicate card ids', () => {
    const invalid = deck(); invalid.cards[0].front.blocks[1] = { type: 'image', assetId: 'mito' };
    invalid.cards.push({ ...invalid.cards[0] });
    expect(validateFlashcardDeck(invalid).errors.join(' ')).toMatch(/alt text.*duplicates/);
  });
  it('projects an existing bank into a text-only deck', () => {
    const projected = projectBankAsFlashcardDeck({ id: 'history/caps/states', title: 'States', items: [{ id: 'wa', type: 'multiple_choice', prompt: 'WA capital?', answer: 'Olympia', choices: ['Olympia', 'Seattle'] }] });
    expect(projected.cards[0].back.blocks[0].text).toBe('Olympia');
  });
});

describe('flashcard queue policy', () => {
  it('takes due cards before new cards and respects the new-card limit', () => {
    const now = new Date('2026-08-24T12:00:00.000Z'); const source = { cards: [{ cardId: 'new-a' }, { cardId: 'due' }, { cardId: 'new-b' }] };
    const selected = selectReviewCards(source, { due: { state: 'learning', dueAt: '2026-08-23T12:00:00.000Z' } }, { now, newLimit: 1 });
    expect(selected.map((card) => card.cardId)).toEqual(['due', 'new-a']);
  });
});

describe('flashcard program enrollment', () => {
  it('normalizes an assignment target around a deck instance', () => {
    expect(validateFlashcardEnrollment({
      programId: 'flashcards', deckId: 'science/cells/organelles',
      policy: { activeMinutes: 20, minimumReviews: 30, masteryPercent: 80 },
    })).toEqual({ errors: [], enrollment: {
      programId: 'flashcards', corpusId: 'science/cells/organelles', deckId: 'science/cells/organelles',
      policy: { activeMinutes: 20, minimumReviews: 30, masteryPercent: 80 },
    } });
  });
  it('allows a required deck assessment without repeating the bank on the assignment', () => {
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: 'cells', policy: { quizRequired: true } }).errors).toEqual([]);
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: 'cells', policy: { linkedQuizBankId: 'science/cells/check' } }).errors.join(' ')).toMatch(/no longer supported/);
  });
});
