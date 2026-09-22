import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import { validateDocumentSource } from '#domains/school/documents/documentSource.mjs';
import { buildWordQuizSource, expandLexiconDeck, validateLexicon } from './index.mjs';

const SEED = fileURLToPath(new URL('../../../../../content/seeds/school/korean-vocab/', import.meta.url));
const read = (name) => yaml.load(fs.readFileSync(path.join(SEED, name), 'utf8'));

const WEEK_ONE = [
  ['annyeong', '안녕', 'phrase'], ['annyeong-haseyo', '안녕하세요', 'phrase'], ['annyeonghi-gyeseyo', '안녕히계세요', 'phrase'],
  ['seonsaengnim', '선생님', 'phrase'], ['chingu-deul', '친구들', 'phrase'], ['ireumi-mwoyeyo', '이름이 뭐예요?', 'phrase'],
  ['ireum', '이름', 'word'], ['gawi', '가위', 'word'], ['pul', '풀', 'word'], ['chaek', '책', 'word'], ['jiugae', '지우개', 'word'],
  ['baindeo', '바인더', 'word'], ['jongi', '종이', 'word'], ['saek-jongi', '색종이', 'word'], ['yeonpil', '연필', 'word'],
  ['saek-yeonpil', '색연필', 'word'], ['gansik', '간식', 'word'], ['hanguk', '한국', 'word'], ['hakgyo', '학교', 'word'],
];

describe('Korean vocab seed package', () => {
  const { errors, entries } = validateLexicon(read('lexicon.yml'));
  it('the lexicon is valid and holds exactly the week-1 list', () => {
    expect(errors).toEqual([]);
    expect([...entries.values()].map((e) => [e.id, e.korean, e.kind])).toEqual(WEEK_ONE);
  });
  it('every phrase carries a pronunciation; decoys are confusable-sized and never the answer', () => {
    for (const entry of entries.values()) {
      if (entry.kind === 'phrase') expect(entry.pronunciation, entry.id).toBeTruthy();
      expect(entry.decoys.korean.length).toBeGreaterThanOrEqual(3);
      expect(entry.decoys.english.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('the week-1 deck expands to 19 valid cards and a valid quiz source', () => {
    const raw = read('week-01-classroom.yml');
    expect(raw.words).toEqual(WEEK_ONE.map(([id]) => id));
    const { errors: deckErrors, deck } = expandLexiconDeck(raw, entries);
    expect(deckErrors).toEqual([]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
    expect(deck.cards).toHaveLength(19);
    expect(validateDocumentSource(buildWordQuizSource({ deck, lexicon: entries, seed: 1 })).errors).toEqual([]);
  });
});
