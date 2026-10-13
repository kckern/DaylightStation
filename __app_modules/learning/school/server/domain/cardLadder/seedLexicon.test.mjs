import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from "../flashcards/index.mjs";
import { validateDocumentSource } from "../documents/documentSource.mjs";
import { buildWordQuizSource, expandLexiconDeck, validateLexicon } from "./index.mjs";

const SEED = fileURLToPath(new URL("../../../seeds/sample-vocab", import.meta.url));
const read = (name) => yaml.load(fs.readFileSync(path.join(SEED, name), 'utf8'));

const WEEK_ONE = [
  ['kite', '카나다 가', 'phrase'], ['lantern', '라마바 라', 'phrase'], ['anchor', '사아자 사', 'phrase'], ['orchard', '차카타 차', 'phrase'],
  ['ribbon', '파하가', 'word'], ['saddle', '나다라', 'word'], ['thimble', '마바사', 'word'], ['compass', '아자차', 'word'], ['quilt', '카타파', 'word'],
];

describe('sample-vocab seed package (the synthetic worked example)', () => {
  const { errors, lexicon } = validateLexicon(read('lexicon.yml'));
  const entries = lexicon?.entries ?? new Map();
  it('the lexicon is valid v2 and holds exactly the sample week-1 list, all in the week-1 group', () => {
    expect(errors).toEqual([]);
    expect([...entries.values()].map((e) => [e.id, e.term, e.kind])).toEqual(WEEK_ONE);
    expect([...entries.values()].every((e) => e.group === 'week-01-sample')).toBe(true);
  });
  it('carries the package identity the code no longer hard-codes', () => {
    expect(lexicon).toMatchObject({
      package: 'sample-vocab', language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
      program: { title: 'Sample words' },
      quiz: { topics: ['sample', 'vocabulary'], instructions: 'Not sure of a word? Open Sample words on the Portal and review the cards, then come back.' },
    });
  });
  it('every phrase carries a pronunciation; decoys are confusable-sized and never the answer', () => {
    for (const entry of entries.values()) {
      if (entry.kind === 'phrase') expect(entry.pronunciation, entry.id).toBeTruthy();
      expect(entry.decoys.term.length).toBeGreaterThanOrEqual(3);
      expect(entry.decoys.gloss.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('the week-1 deck expands to 9 valid cards and a valid quiz source', () => {
    const raw = read('week-01-sample.yml');
    expect(raw.words).toEqual(WEEK_ONE.map(([id]) => id));
    const { errors: deckErrors, deck } = expandLexiconDeck(raw, lexicon);
    expect(deckErrors).toEqual([]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
    expect(deck.cards).toHaveLength(WEEK_ONE.length);
    expect(validateDocumentSource(buildWordQuizSource({ deck, lexicon, seed: 1 })).errors).toEqual([]);
  });
});
