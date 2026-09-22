import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import {
  LEXICON_SCHEMA, expandLexiconDeck, isLexiconDeck, parseMediaRef, validateLexicon, wordAssetIds, wordPackageDir,
} from './index.mjs';

const REF = 'media:language/korean-vocab/lexicon.yml';
const entry = (over = {}) => ({
  id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null,
  decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] }, ...over,
});
const phrase = (over = {}) => entry({
  id: 'annyeong', kind: 'phrase', korean: '안녕', english: 'Hi (casual)', pronunciation: 'an-nyeong',
  decoys: { korean: ['안녕하세요', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] }, ...over,
});
const hello = () => entry({
  id: 'annyeong-haseyo', kind: 'phrase', korean: '안녕하세요', english: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo',
  decoys: { korean: ['안녕히계세요', '안녕', '안녕히가세요'], english: ['Hi (casual)', 'Goodbye', 'Thank you'] },
});
const lexicon = (entries) => ({ schema: LEXICON_SCHEMA, entries });

describe('validateLexicon', () => {
  it('accepts a well-formed lexicon and indexes it by id', () => {
    const { errors, entries } = validateLexicon(lexicon([entry(), phrase(), hello()]));
    expect(errors).toEqual([]);
    expect([...entries.keys()]).toEqual(['gawi', 'annyeong', 'annyeong-haseyo']);
    expect(entries.get('annyeong').pronunciation).toBe('an-nyeong');
  });
  it('requires a pronunciation for every phrase', () => {
    expect(validateLexicon(lexicon([phrase({ pronunciation: null })])).errors.join('\n')).toMatch(/pronunciation: is required for a phrase/);
  });
  it('needs at least three decoys on each side, none equal to the answer', () => {
    const few = validateLexicon(lexicon([entry({ decoys: { korean: ['가지'], english: ['Knife', 'Tape', 'Ruler'] } })]));
    expect(few.errors.join('\n')).toMatch(/decoys.korean: needs at least 3/);
    const self = validateLexicon(lexicon([entry({ decoys: { korean: ['가지', '바위', '가방'], english: ['scissors', 'Tape', 'Ruler'] } })]));
    expect(self.errors.join('\n')).toMatch(/must not contain the answer 'Scissors'/);
  });
  it('rejects a decoy that is an in-set entry of the other kind', () => {
    const bad = phrase({ decoys: { korean: ['가위', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] } });
    expect(validateLexicon(lexicon([entry(), bad])).errors.join('\n'))
      .toMatch(/decoy '가위' is the word 'gawi' — decoys must be the same kind/);
  });
  it('rejects duplicate ids and a wrong schema', () => {
    const { errors } = validateLexicon({ schema: 'x', entries: [entry(), entry()] });
    expect(errors.join('\n')).toMatch(/schema must be school.word-lexicon\/v1/);
    expect(errors.join('\n')).toMatch(/duplicates 'gawi'/);
  });
});

describe('media refs', () => {
  it('parses media: references and refuses traversal', () => {
    expect(parseMediaRef(REF)).toEqual({ ok: true, path: 'language/korean-vocab/lexicon.yml' });
    expect(parseMediaRef('media:../etc/passwd').ok).toBe(false);
    expect(parseMediaRef('media:/abs').ok).toBe(false);
    expect(parseMediaRef('language/x.yml').ok).toBe(false);
  });
  it('derives the word package directory and per-word asset ids', () => {
    expect(wordPackageDir(REF)).toBe('language/korean-vocab');
    expect(wordPackageDir('media:language/korean-vocab/other.yml')).toBeNull();
    expect(wordAssetIds(REF, 'gawi')).toEqual({
      image: 'media:language/korean-vocab/words/gawi/image.jpg',
      audio: 'media:language/korean-vocab/words/gawi/ko.mp3',
      englishAudio: 'media:language/korean-vocab/words/gawi/en.mp3',
    });
  });
});

describe('expandLexiconDeck', () => {
  const { entries } = validateLexicon(lexicon([entry(), phrase(), hello()]));
  const raw = {
    schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom',
    revision: 1, lexicon: REF, words: ['annyeong', 'gawi'],
  };
  it('recognises a lexicon deck', () => {
    expect(isLexiconDeck(raw)).toBe(true);
    expect(isLexiconDeck({ cards: [] })).toBe(false);
  });
  it('turns words into ordinary cards that pass validateFlashcardDeck', () => {
    const { errors, deck } = expandLexiconDeck(raw, entries);
    expect(errors).toEqual([]);
    expect(deck.words).toEqual(['annyeong', 'gawi']);
    expect(deck.cards.map((card) => card.cardId)).toEqual(['annyeong', 'gawi']);
    expect(deck.cards[1].front.blocks).toEqual([
      { type: 'image', assetId: 'media:language/korean-vocab/words/gawi/image.jpg', alt: 'Scissors' },
      { type: 'text', text: '가위' },
      { type: 'audio', assetId: 'media:language/korean-vocab/words/gawi/ko.mp3', transcript: '가위' },
    ]);
    expect(deck.cards[1].back.blocks).toEqual([{ type: 'text', text: 'Scissors' }]);
    expect(deck.cards[0].back.blocks).toEqual([{ type: 'text', text: 'Hi (casual)' }, { type: 'text', text: 'an-nyeong' }]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
  });
  it('refuses unknown or duplicate words and authored cards', () => {
    expect(expandLexiconDeck({ ...raw, words: ['nope'] }, entries).errors.join('\n')).toMatch(/'nope' is not in the lexicon/);
    expect(expandLexiconDeck({ ...raw, words: ['gawi', 'gawi'] }, entries).errors.join('\n')).toMatch(/duplicates 'gawi'/);
    expect(expandLexiconDeck({ ...raw, cards: [] }, entries).errors.join('\n')).toMatch(/must not also author cards/);
  });
});
