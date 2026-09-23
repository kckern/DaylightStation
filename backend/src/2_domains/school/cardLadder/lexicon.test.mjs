import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import {
  LEXICON_SCHEMA, LEXICON_SCHEMA_V3, expandLexiconDeck, isLexiconDeck, parseMediaRef, validateLexicon, wordAssetIds, wordPackageDir,
} from './index.mjs';

// Korean is the worked example; the Spanish case below proves nothing is Korean-specific.
const REF = 'media:language/korean-vocab/lexicon.yml';
const GROUP = 'week-01-classroom';
const entry = (over = {}) => ({
  id: 'gawi', kind: 'word', group: GROUP, term: '가위', gloss: 'Scissors', pronunciation: null,
  decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] }, ...over,
});
const phrase = (over = {}) => entry({
  id: 'annyeong', kind: 'phrase', term: '안녕', gloss: 'Hi (casual)', pronunciation: 'an-nyeong',
  decoys: { term: ['안녕하세요', '안녕히계세요', '안경'], gloss: ['Hello (polite)', 'Thank you', 'Excuse me'] }, ...over,
});
const hello = () => entry({
  id: 'annyeong-haseyo', kind: 'phrase', term: '안녕하세요', gloss: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo',
  decoys: { term: ['안녕히계세요', '안녕', '안녕히가세요'], gloss: ['Hi (casual)', 'Goodbye', 'Thank you'] },
});
const HEADER = {
  package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' },
  gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
};
const lexicon = (entries, over = {}) => ({ schema: LEXICON_SCHEMA, ...HEADER, entries, ...over });

describe('validateLexicon', () => {
  it('accepts a well-formed lexicon, carries its language identity and indexes entries by id', () => {
    const { errors, lexicon: lex } = validateLexicon(lexicon([entry(), phrase(), hello()]));
    expect(errors).toEqual([]);
    expect(lex).toMatchObject({
      package: 'korean-vocab', language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
      program: { title: 'Korean words' },
    });
    expect([...lex.entries.keys()]).toEqual(['gawi', 'annyeong', 'annyeong-haseyo']);
    expect(lex.entries.get('annyeong')).toMatchObject({ term: '안녕', gloss: 'Hi (casual)', pronunciation: 'an-nyeong', group: GROUP });
  });
  it('defaults quiz topics and instructions from the language and program title', () => {
    const { lexicon: lex } = validateLexicon(lexicon([entry()]));
    expect(lex.quiz.topics).toEqual(['korean', 'vocabulary']);
    expect(lex.quiz.instructions).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
    const custom = validateLexicon(lexicon([entry()], { quiz: { topics: ['k'], instructions: 'Ask a grown-up.' } })).lexicon;
    expect(custom.quiz).toEqual({ topics: ['k'], instructions: 'Ask a grown-up.' });
  });
  it('requires package, both languages and a program title', () => {
    const { errors } = validateLexicon({ schema: LEXICON_SCHEMA, entries: [entry()] });
    const all = errors.join('\n');
    for (const field of ['package', 'language', 'gloss', 'program.title']) expect(all).toContain(field);
    expect(validateLexicon(lexicon([entry()], { language: { code: 'Korean', name: 'Korean' } })).errors.join('\n'))
      .toMatch(/language.code: must be a BCP-47/);
  });
  it('rejects a v1 lexicon with a clear migration error', () => {
    const { errors } = validateLexicon({ schema: 'school.word-lexicon/v1', entries: [{ id: 'gawi' }] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/school.word-lexicon\/v1 is no longer read: migrate to school.word-lexicon\/v2/);
  });
  it('requires a slug group per entry and refuses traversal in it', () => {
    expect(validateLexicon(lexicon([entry({ group: undefined })])).errors.join('\n')).toMatch(/entries\[0\].group: must be a lowercase slug/);
    expect(validateLexicon(lexicon([entry({ group: '../escape' })])).errors.join('\n')).toMatch(/group: must be a lowercase slug/);
    expect(validateLexicon(lexicon([entry({ group: 'Week 1' })])).errors.join('\n')).toMatch(/group: must be a lowercase slug/);
  });
  it('requires a pronunciation for every phrase', () => {
    expect(validateLexicon(lexicon([phrase({ pronunciation: null })])).errors.join('\n')).toMatch(/pronunciation: is required for a phrase/);
  });
  it('needs at least three decoys on each side, none equal to the answer', () => {
    const few = validateLexicon(lexicon([entry({ decoys: { term: ['가지'], gloss: ['Knife', 'Tape', 'Ruler'] } })]));
    expect(few.errors.join('\n')).toMatch(/decoys.term: needs at least 3/);
    const self = validateLexicon(lexicon([entry({ decoys: { term: ['가지', '바위', '가방'], gloss: ['scissors', 'Tape', 'Ruler'] } })]));
    expect(self.errors.join('\n')).toMatch(/must not contain the answer 'Scissors'/);
  });
  it('rejects a decoy that is an in-set entry of the other kind', () => {
    const bad = phrase({ decoys: { term: ['가위', '안녕히계세요', '안경'], gloss: ['Hello (polite)', 'Thank you', 'Excuse me'] } });
    expect(validateLexicon(lexicon([entry(), bad])).errors.join('\n'))
      .toMatch(/decoy '가위' is the word 'gawi' — decoys must be the same kind/);
  });
  it('rejects duplicate ids and a wrong schema', () => {
    const { errors } = validateLexicon({ ...lexicon([entry(), entry()]), schema: 'x' });
    expect(errors.join('\n')).toMatch(/schema must be school.word-lexicon\/v2/);
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
  it('derives the word package directory and grouped, language-neutral per-word asset ids', () => {
    expect(wordPackageDir(REF)).toBe('language/korean-vocab');
    expect(wordPackageDir('media:language/korean-vocab/other.yml')).toBeNull();
    expect(wordAssetIds(REF, { id: 'gawi', group: GROUP })).toEqual({
      image: 'media:language/korean-vocab/words/week-01-classroom/gawi/image.jpg',
      audio: 'media:language/korean-vocab/words/week-01-classroom/gawi/term.mp3',
      glossAudio: 'media:language/korean-vocab/words/week-01-classroom/gawi/gloss.mp3',
    });
  });
  it('refuses an asset path for an invalid group', () => {
    expect(() => wordAssetIds(REF, { id: 'gawi', group: '..' })).toThrow(/no asset path/);
    expect(() => wordAssetIds(REF, { id: 'gawi' })).toThrow(/no asset path/);
  });
});

describe('expandLexiconDeck', () => {
  const { lexicon: lex } = validateLexicon(lexicon([entry(), phrase(), hello()]));
  const raw = {
    schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom',
    revision: 1, lexicon: REF, words: ['annyeong', 'gawi'],
  };
  it('recognises a lexicon deck', () => {
    expect(isLexiconDeck(raw)).toBe(true);
    expect(isLexiconDeck({ cards: [] })).toBe(false);
  });
  it('turns words into ordinary cards that pass validateFlashcardDeck', () => {
    const { errors, deck } = expandLexiconDeck(raw, lex);
    expect(errors).toEqual([]);
    expect(deck.words).toEqual(['annyeong', 'gawi']);
    expect(deck.cards.map((card) => card.cardId)).toEqual(['annyeong', 'gawi']);
    expect(deck.cards[1].front.blocks).toEqual([
      { type: 'image', assetId: 'media:language/korean-vocab/words/week-01-classroom/gawi/image.jpg', alt: 'Scissors' },
      { type: 'text', text: '가위' },
      { type: 'audio', assetId: 'media:language/korean-vocab/words/week-01-classroom/gawi/term.mp3', transcript: '가위' },
    ]);
    expect(deck.cards[1].back.blocks).toEqual([{ type: 'text', text: 'Scissors' }]);
    expect(deck.cards[0].back.blocks).toEqual([{ type: 'text', text: 'Hi (casual)' }, { type: 'text', text: 'an-nyeong' }]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
  });
  it('refuses unknown or duplicate words and authored cards', () => {
    expect(expandLexiconDeck({ ...raw, words: ['nope'] }, lex).errors.join('\n')).toMatch(/'nope' is not in the lexicon/);
    expect(expandLexiconDeck({ ...raw, words: ['gawi', 'gawi'] }, lex).errors.join('\n')).toMatch(/duplicates 'gawi'/);
    expect(expandLexiconDeck({ ...raw, cards: [] }, lex).errors.join('\n')).toMatch(/must not also author cards/);
  });
});

describe('validateLexicon — side-neutral names (target / anchor)', () => {
  it('reads target:/anchor: entry fields and decoy sides as term/gloss', () => {
    const neutral = {
      id: 'gawi', kind: 'word', group: GROUP, target: '가위', anchor: 'Scissors', pronunciation: null,
      decoys: { target: ['가지', '바위', '가방'], anchor: ['Knife', 'Tape', 'Ruler'] },
    };
    const { errors, lexicon: lex } = validateLexicon(lexicon([neutral, phrase(), hello()]));
    expect(errors).toEqual([]);
    expect(lex.entries.get('gawi')).toMatchObject({ term: '가위', gloss: 'Scissors', decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } });
  });
  it('refuses a term and a target that disagree', () => {
    const { errors } = validateLexicon(lexicon([entry({ target: '바위' }), phrase(), hello()]));
    expect(errors).toContain('entries[0]: term and target name the same side and must agree');
  });
  it('v2 exposes the target and anchor languages and the target script', () => {
    const { lexicon: lex } = validateLexicon(lexicon([entry(), phrase(), hello()]));
    expect(lex.targetLanguage).toEqual({ code: 'ko', name: 'Korean' });
    expect(lex.anchorLanguage).toEqual({ code: 'en', name: 'English' });
    expect(lex.targetScript).toBe('hangul');
  });
  it('v3 names the language blocks target:/anchor:, and an English-to-English set is generic', () => {
    const define = (id, target, anchor) => ({
      id, kind: 'word', group: 'unit-1', target, anchor, pronunciation: null,
      decoys: { target: ['alpha', 'beta', 'gamma'], anchor: ['one thing', 'another thing', 'a third thing'] },
    });
    const { errors, lexicon: lex } = validateLexicon({
      schema: LEXICON_SCHEMA_V3, package: 'english-definitions',
      target: { code: 'en', name: 'English' }, anchor: { code: 'en', name: 'English' },
      program: { title: 'Definitions' },
      entries: [define('ephemeral', 'ephemeral', 'lasting a very short time')],
    });
    expect(errors).toEqual([]);
    expect(lex).toMatchObject({ language: { code: 'en' }, gloss: { code: 'en' }, targetScript: 'generic' });
    expect(lex.entries.get('ephemeral')).toMatchObject({ term: 'ephemeral', gloss: 'lasting a very short time' });
  });
  it('v3 without target:/anchor: language blocks is refused', () => {
    const { errors } = validateLexicon({ ...lexicon([entry(), phrase(), hello()]), schema: LEXICON_SCHEMA_V3 });
    expect(errors).toEqual(expect.arrayContaining(['target: must be a mapping with code and name', 'anchor: must be a mapping with code and name']));
  });
});
