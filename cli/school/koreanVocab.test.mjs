import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { buildEnrollPlan, main, resolveDeckId } from './koreanVocab.mjs';

const LEXICON = { schema: 'school.word-lexicon/v1', entries: [
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
] };

async function fixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
}
const io = () => ({ stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });

describe('korean-vocab CLI', () => {
  it('resolves a deck slug', () => {
    expect(resolveDeckId('week-01-classroom')).toBe('language/korean/week-01-classroom');
    expect(resolveDeckId('language/korean/week-02-home')).toBe('language/korean/week-02-home');
  });
  it('quiz writes a document source under the learning-catalog documents root, idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'korean-vocab-'));
    try {
      await fixture(root);
      const argv = ['quiz', '--deck', 'week-01-classroom', '--data-dir', path.join(root, 'data'), '--media-dir', path.join(root, 'media')];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/week-01-classroom-quiz.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/week-01-classroom-quiz');
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(await main(argv, io())).toBe(0);
      await writeFile(file, 'schema: school.document-source/v1\nid: hand-edited\n');
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
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
