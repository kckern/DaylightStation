import { describe, expect, it } from 'vitest';
import { projectBankAsFlashcardDeck, validateFlashcardDeck } from './flashcardDeck.mjs';
import { initialCardProgress, scheduleReview, selectReviewCards } from './reviewScheduler.mjs';

const deck = () => ({
  schema: 'school.flashcard-deck/v1', id: 'science/cells/organelles', title: 'Cell organelles',
  cards: [{ cardId: 'mitochondrion', front: { blocks: [{ type: 'text', text: 'Energy?' }, { type: 'image', assetId: 'mito', alt: 'Mitochondrion' }] }, back: { blocks: [{ type: 'text', text: 'Mitochondrion' }, { type: 'audio', assetId: 'say-mito', transcript: 'mitochondrion' }] } }],
});

describe('flashcard decks', () => {
  it('accepts accessible rich faces', () => expect(validateFlashcardDeck(deck()).errors).toEqual([]));
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

describe('flashcard scheduler adapter', () => {
  it('relearns a lapse shortly and expands successful review intervals', () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const lapse = scheduleReview(initialCardProgress({ now }), 'again', { now });
    expect(lapse.state).toBe('learning');
    expect(Date.parse(lapse.dueAt) - now.getTime()).toBe(10 * 60 * 1000);
    const good = scheduleReview(lapse, 'good', { now });
    expect(Date.parse(good.dueAt) - now.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
  it('takes due cards before new cards and respects the new-card limit', () => {
    const now = new Date('2026-08-24T12:00:00.000Z'); const source = { cards: [{ cardId: 'new-a' }, { cardId: 'due' }, { cardId: 'new-b' }] };
    const selected = selectReviewCards(source, { due: { state: 'learning', dueAt: '2026-08-23T12:00:00.000Z' } }, { now, newLimit: 1 });
    expect(selected.map((card) => card.cardId)).toEqual(['due', 'new-a']);
  });
});
