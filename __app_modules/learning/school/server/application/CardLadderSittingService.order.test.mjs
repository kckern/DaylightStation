import { describe, expect, it } from 'vitest';
import { orderNewWords } from "../domain/cardLadder/index.mjs";
import { DECK, REF, SETTINGS, lexicon, make } from "../../../../../tests/_lib/school/cardLadderSittingFixtures.mjs";
import { validateFlashcardEnrollment } from "../domain/flashcards/flashcardEnrollment.mjs";

const IDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];
const template = lexicon.entries.get('pul');
const lexiconData = { ...lexicon, entries: new Map(IDS.map((id, i) => [id, { ...template, id, term: `단어${i}`, gloss: `Word ${i}` }])) };
const decks = { getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, words: IDS, lexicon: REF } : null) };
const RANDOM = { ...SETTINGS, batch: { ...SETTINGS.batch, order: 'random' } };
const program = (policy) => [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'card-ladder', ...policy } }];
const firstNew = async (opts) => (await make({ decks, lexiconData, ...opts }).service.open({ userId: 'test-learner', deckId: DECK })).item.word.term;

describe('CardLadderSittingService — per-program new-word order', () => {
  const shuffledFirst = orderNewWords([{ deckId: DECK, ids: IDS }], { order: 'random', learnerId: 'test-learner' })[0];

  it('the fixture shuffle does not start with the deck\'s first word (guards the tests below)', () => {
    expect(shuffledFirst).not.toBe('w1');
  });

  it('policy.order deck introduces in authored order even when the household default is random', async () => {
    expect(await firstNew({ settings: RANDOM, programs: program({}) })).toBe(lexiconData.entries.get(shuffledFirst).term);
    expect(await firstNew({ settings: RANDOM, programs: program({ order: 'deck' }) })).toBe('단어0');
  });

  it('policy.order random overrides a household deck order', async () => {
    expect(await firstNew({ programs: program({}) })).toBe('단어0');
    expect(await firstNew({ programs: program({ order: 'random' }) })).toBe(lexiconData.entries.get(shuffledFirst).term);
  });
});

describe('validateFlashcardEnrollment — policy.order', () => {
  const row = (policy) => ({ programId: 'flashcards', deckId: DECK, policy });
  it('accepts deck or random on a card ladder', () => {
    expect(validateFlashcardEnrollment(row({ mode: 'card-ladder', order: 'deck' })).enrollment.policy.order).toBe('deck');
    expect(validateFlashcardEnrollment(row({ mode: 'card-ladder', order: 'random' })).errors).toEqual([]);
  });
  it('rejects other values, and order on an fsrs program', () => {
    expect(validateFlashcardEnrollment(row({ mode: 'card-ladder', order: 'alpha' })).errors).toContain('policy.order must be deck or random');
    expect(validateFlashcardEnrollment(row({ mode: 'fsrs', order: 'deck' })).errors).toContain('policy.order is only used by card-ladder');
  });
});
