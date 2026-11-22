/**
 * createCardLadderTitleFor — a card ladder package's person-facing name,
 * read from the lexicon of the deck that names the package.
 */
import { describe, it, expect } from 'vitest';
import { createCardLadderTitleFor, packageOfLexicon } from '../../../../__app_modules/learning/school/server/application/cardLadderTitles.mjs';

const decks = [
  { id: 'deck-plain', words: [] },
  { id: 'deck-ko', lexicon: 'media:card-ladder/korean-vocab/lexicon.yml' },
  { id: 'deck-es', lexicon: 'media:card-ladder/spanish-vocab/lexicon.yml' },
];
const lexicons = {
  'media:card-ladder/korean-vocab/lexicon.yml': { package: 'korean-vocab', program: { title: 'Korean words' } },
};

function recordingLogger() {
  const events = [];
  return { events, debug: (event, data) => events.push({ event, data }) };
}

describe('packageOfLexicon', () => {
  it('is the lexicon directory name', () => {
    expect(packageOfLexicon('media:card-ladder/korean-vocab/lexicon.yml')).toBe('korean-vocab');
    expect(packageOfLexicon('media:card-ladder/korean-vocab/other.yml')).toBeNull();
    expect(packageOfLexicon('not-media')).toBeNull();
  });
});

describe('createCardLadderTitleFor', () => {
  const getLexicon = (ref) => {
    if (!lexicons[ref]) throw new Error(`lexicon '${ref}': not found`);
    return lexicons[ref];
  };

  it('names a package from its deck lexicon', async () => {
    const titleFor = createCardLadderTitleFor({ listDecks: async () => decks, getLexicon });
    expect(await titleFor('korean-vocab')).toBe('Korean words');
  });

  it('is null when no deck names the package', async () => {
    const titleFor = createCardLadderTitleFor({ listDecks: () => decks, getLexicon });
    expect(await titleFor('french-vocab')).toBeNull();
  });

  it('is null (and logs at debug) when the lexicon will not load', async () => {
    const logger = recordingLogger();
    const titleFor = createCardLadderTitleFor({ listDecks: () => decks, getLexicon, logger });
    expect(await titleFor('spanish-vocab')).toBeNull();
    expect(logger.events).toEqual([{ event: 'school.card-ladder.title-unresolved', data: { package: 'spanish-vocab', error: expect.stringMatching(/not found/) } }]);
  });

  it('is null when listing decks fails', async () => {
    const titleFor = createCardLadderTitleFor({ listDecks: async () => { throw new Error('catalog down'); }, getLexicon });
    expect(await titleFor('korean-vocab')).toBeNull();
  });

  it('requires both lookups', () => {
    expect(() => createCardLadderTitleFor({ getLexicon })).toThrow(/listDecks/);
    expect(() => createCardLadderTitleFor({ listDecks: () => [] })).toThrow(/getLexicon/);
  });
});
