import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { buildEnrollPlan, main, resolveDeckId } from './wordLadder.mjs';

// Korean is the worked example; nothing in the CLI names it.
const LEXICON = {
  schema: 'school.word-lexicon/v2', package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [
    { id: 'gawi', kind: 'word', group: 'week-01-classroom', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
  ],
};

async function fixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
  await writeFile(path.join(decks, 'week-02-home.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-02-home', title: 'Korean — Home', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
}
const dirs = (root) => ['--data-dir', path.join(root, 'data'), '--media-dir', path.join(root, 'media')];
const io = () => ({ stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });

describe('word-ladder CLI', () => {
  it('resolves a full deck id as-is, and a bare slug only when exactly one deck ends with it', () => {
    const ids = ['language/korean/week-01-classroom', 'language/spanish/week-01-classroom', 'language/spanish/unit-02'];
    expect(resolveDeckId('language/korean/week-02-home', ids)).toBe('language/korean/week-02-home');
    expect(resolveDeckId('unit-02', ids)).toBe('language/spanish/unit-02');
    expect(() => resolveDeckId('week-01-classroom', ids)).toThrow(/ambiguous: language\/korean\/week-01-classroom, language\/spanish\/week-01-classroom/);
    expect(() => resolveDeckId('week-09', ids)).toThrow(/no flashcard deck matches 'week-09'/);
  });
  it('quiz writes a document source under the learning-catalog documents root, idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'word-ladder-'));
    try {
      await fixture(root);
      const argv = ['quiz', '--deck', 'week-01-classroom', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/week-01-classroom-quiz.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/week-01-classroom-quiz');
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(source.header.instructions).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
      expect(source.topics).toEqual(['korean', 'vocabulary']);
      expect(await main(argv, io())).toBe(0);
      await writeFile(file, 'schema: school.document-source/v1\nid: hand-edited\n');
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('buildEnrollPlan needs a title (the CLI supplies the lexicon\'s program.title)', () => {
    expect(() => buildEnrollPlan({ programs: [] }, { deckId: 'language/korean/week-02-home' })).toThrow(/tile title/);
  });

  it('enroll-plan defaults the tile title to the lexicon\'s program.title when --title is omitted', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'word-ladder-enroll-'));
    try {
      await fixture(root);
      const out = path.join(root, 'plan.yml');
      const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [], units: [], programs: [] }) }));
      const argv = ['enroll-plan', '--learner', 'kid', '--deck', 'week-02-home', '--out', out, ...dirs(root)];
      expect(await main(argv, io(), { fetch: fetchImpl })).toBe(0);
      const plan = load(await readFile(out, 'utf8'));
      expect(plan.programs).toEqual([
        { programId: 'flashcards', deckId: 'language/korean/week-02-home', title: 'Korean words', policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('enroll-plan appends (or replaces) the word-ladder program and keeps everything else', () => {
    const current = {
      learnerId: 'kid', updatedAt: '2026-09-04T05:35:39.484Z',
      courses: [{ courseId: 'atlas' }], units: [],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean' }, { programId: 'flashcards', deckId: 'language/korean/week-01-classroom', policy: { mode: 'word-ladder' } }],
    };
    const plan = buildEnrollPlan(current, { deckId: 'language/korean/week-02-home', title: 'Korean words' });
    expect(plan.courses).toEqual(current.courses);
    expect(plan.programs).toEqual([
      { programId: 'sentence-ladder', corpusId: 'glossika-korean' },
      { programId: 'flashcards', deckId: 'language/korean/week-02-home', title: 'Korean words', policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
    ]);
  });
});
