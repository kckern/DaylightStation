import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlLearningContentRepository } from './YamlLearningContentRepository.mjs';
import { YamlLexiconRepository } from './YamlLexiconRepository.mjs';
import { LexiconDeckLoader } from './LexiconDeckLoader.mjs';

const LEXICON = {
  schema: 'school.word-lexicon/v2',
  package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' },
  gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [{ id: 'gawi', kind: 'word', group: 'week-01-classroom', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } }],
};
const WORD_DECK = { schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] };
const PLAIN_DECK = { schema: 'school.flashcard-deck/v1', id: 'biology/cells', title: 'Cells', cards: [{ cardId: 'cell', front: { blocks: [{ type: 'text', text: 'Cell' }] }, back: { blocks: [{ type: 'text', text: 'Unit of life' }] } }] };

let root;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lexicon-loader-'));
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await mkdir(path.join(root, 'decks/language/korean'), { recursive: true });
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'banks'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  await writeFile(path.join(root, 'decks/language/korean/week-01-classroom.yml'), dump(WORD_DECK));
  await writeFile(path.join(root, 'decks/cells.yml'), dump(PLAIN_DECK));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function loader(logger = null) {
  const content = new YamlLearningContentRepository({
    documentDirectories: [path.join(root, 'docs')], bankDirectories: [path.join(root, 'banks')], deckDirectories: [path.join(root, 'decks')],
  });
  return new LexiconDeckLoader({ content, lexicons: new YamlLexiconRepository({ mediaRoot: path.join(root, 'media/school') }), logger });
}

describe('LexiconDeckLoader', () => {
  it('expands a lexicon deck through getFlashcardDeck', async () => {
    const deck = await loader().getFlashcardDeck(WORD_DECK.id);
    expect(deck.cards.map((card) => card.cardId)).toEqual(['gawi']);
    expect(deck.words).toEqual(['gawi']);
    expect(deck.lexicon).toBe(WORD_DECK.lexicon);
  });
  it('expands lexicon decks through listFlashcardDecks and passes plain decks through', async () => {
    const decks = await loader().listFlashcardDecks();
    const byId = Object.fromEntries(decks.map((deck) => [deck.id, deck]));
    expect(byId[WORD_DECK.id].cards).toHaveLength(1);
    expect(byId['biology/cells']).toEqual(PLAIN_DECK);
  });
  it('drops (and logs) a lexicon deck that cannot be expanded from list, but throws from get', async () => {
    await writeFile(path.join(root, 'decks/language/korean/week-01-classroom.yml'), dump({ ...WORD_DECK, words: ['nope'] }));
    const logger = { error: vi.fn() };
    const decks = await loader(logger).listFlashcardDecks();
    expect(decks.map((deck) => deck.id)).toEqual(['biology/cells']);
    expect(logger.error).toHaveBeenCalledWith('school.word-ladder.deck-unexpandable', expect.objectContaining({ deckId: WORD_DECK.id }));
    await expect(loader().getFlashcardDeck(WORD_DECK.id)).rejects.toThrow(/'nope' is not in the lexicon/);
  });
  it('refuses a lexicon reference that leaves the media root', () => {
    const lexicons = new YamlLexiconRepository({ mediaRoot: path.join(root, 'media/school') });
    expect(() => lexicons.getLexicon('media:../../decks/cells.yml')).toThrow(/must not contain/);
    expect(() => lexicons.getLexicon('media:language/korean-vocab/missing.yml')).toThrow(/not found/);
  });
  it('delegates non-deck reads unchanged', async () => {
    const content = { getDocument: vi.fn(async () => 'doc'), getQuestionBank: vi.fn(async () => 'bank'), getLearningAction: vi.fn(async () => 'action'), getFlashcardDeck: vi.fn(), listFlashcardDecks: vi.fn() };
    const wrapped = new LexiconDeckLoader({ content, lexicons: { getLexicon: vi.fn() } });
    await expect(wrapped.getDocument('d')).resolves.toBe('doc');
    await expect(wrapped.getQuestionBank('b')).resolves.toBe('bank');
    await expect(wrapped.getLearningAction('a')).resolves.toBe('action');
  });
});
