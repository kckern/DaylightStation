import { wordPackageDir } from '../domain/cardLadder/index.mjs';

const NOOP_LOGGER = Object.freeze({});

/** A lexicon ref's package id: its directory's last segment (`media:.../korean-vocab/lexicon.yml` → `korean-vocab`). */
export function packageOfLexicon(lexiconRef) {
  const dir = wordPackageDir(lexiconRef);
  return dir ? dir.split('/').filter(Boolean).pop() ?? null : null;
}

/**
 * createCardLadderTitleFor — names a card ladder package for a person.
 *
 * The card ladder store keys learners by package slug; the title lives in the
 * package lexicon (`program.title`). It is reached the way the sitting
 * service does it: deck → its lexicon ref → the lexicon, whose package is the
 * ref's directory name.
 *
 * Returns `async (packageId) => string|null`: null when no deck names the
 * package, the lexicon will not load, or it has no title (logged at debug as
 * `school.card-ladder.title-unresolved`).
 */
export function createCardLadderTitleFor({ listDecks, getLexicon, packageOf = packageOfLexicon, logger = NOOP_LOGGER } = {}) {
  if (typeof listDecks !== 'function') throw new Error('createCardLadderTitleFor requires listDecks');
  if (typeof getLexicon !== 'function') throw new Error('createCardLadderTitleFor requires getLexicon');
  return async (packageId) => {
    try {
      const decks = (await listDecks()) ?? [];
      const deck = (Array.isArray(decks) ? decks : []).find((d) => typeof d?.lexicon === 'string' && packageOf(d.lexicon) === packageId);
      if (!deck) return null;
      const title = (await getLexicon(deck.lexicon))?.program?.title;
      return typeof title === 'string' && title.trim() ? title.trim() : null;
    } catch (error) {
      logger.debug?.('school.card-ladder.title-unresolved', { package: packageId, error: error?.message ?? String(error) });
      return null;
    }
  };
}

export default createCardLadderTitleFor;
