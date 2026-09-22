import { ILearningContentRepository } from '#apps/school/ports/ILearningContentRepository.mjs';
import { expandLexiconDeck, isLexiconDeck } from '#domains/school/wordLadder/index.mjs';

/** A lexicon deck with ordinary cards; any other deck unchanged. Throws on an invalid deck. */
export function expandDeckWithLexicons(raw, lexicons) {
  if (!isLexiconDeck(raw)) return raw;
  const { errors, deck } = expandLexiconDeck(raw, lexicons.getLexicon(raw.lexicon));
  if (errors.length) throw new Error(errors.join('; '));
  return deck;
}

/**
 * Expands `words` decks BEFORE anyone validates them (validateFlashcardDeck
 * rejects a deck with no `cards`). Wraps get AND list, so the deck browser,
 * FlashcardStudyService, enrollment validation and the word ladder all see
 * the same cards.
 */
export class LexiconDeckLoader extends ILearningContentRepository {
  #content; #lexicons; #logger;
  constructor({ content, lexicons, logger = null } = {}) {
    super();
    if (!content?.getFlashcardDeck) throw new Error('LexiconDeckLoader requires content');
    if (!lexicons?.getLexicon) throw new Error('LexiconDeckLoader requires lexicons');
    this.#content = content; this.#lexicons = lexicons; this.#logger = logger;
  }
  async getDocument(documentId) { return this.#content.getDocument(documentId); }
  async getQuestionBank(bankId) { return this.#content.getQuestionBank(bankId); }
  async getLearningAction(actionId) { return this.#content.getLearningAction(actionId); }
  async getFlashcardDeck(deckId) {
    const raw = await this.#content.getFlashcardDeck(deckId);
    return raw ? expandDeckWithLexicons(raw, this.#lexicons) : null;
  }
  async listFlashcardDecks() {
    const decks = await this.#content.listFlashcardDecks();
    return decks.flatMap((raw) => {
      try { return [expandDeckWithLexicons(raw, this.#lexicons)]; } catch (error) {
        this.#logger?.error?.('school.word-ladder.deck-unexpandable', { deckId: raw?.id ?? null, error: error.message });
        return [];
      }
    });
  }
}
export default LexiconDeckLoader;
