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

// A two-word lexicon so an "introduced words only" filter has something to exclude.
const LEARNER_LEXICON = {
  schema: 'school.word-lexicon/v2', package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [
    { id: 'gawi', kind: 'word', group: 'week-01-classroom', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
    { id: 'pul', kind: 'word', group: 'week-01-classroom', term: '풀', gloss: 'Glue', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
  ],
};
async function learnerFixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEARNER_LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({
    schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom',
    revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi', 'pul'],
  }));
}
function statusFile(root, learnerId, pkg) {
  return path.join(root, 'data/users', learnerId, 'apps/school/word-ladder', pkg, 'status.yml');
}

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
  it('quiz --learner writes a per-learner document source over introduced words only, idempotently, refusing an unforced overwrite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'word-ladder-learner-'));
    try {
      await learnerFixture(root);
      const sf = statusFile(root, 'test-learner', 'korean-vocab');
      await mkdir(path.dirname(sf), { recursive: true });
      await writeFile(sf, dump({
        schema: 'school.word-ladder-status/v3',
        words: { gawi: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-01', rechecks: 0, lastGraded: null } },
        decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [],
      }));
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-W39', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/korean-vocab-quiz-test-learner-2026-W39.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/korean-vocab-quiz-test-learner-2026-W39');
      // only 'gawi' is introduced; 'pul' has no status entry (still new) and is excluded.
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(source.title).toBe('Korean words — week 2026-W39');

      expect(await main(argv, io())).toBe(0); // second run: unchanged

      // A changed status (pul now introduced too) makes a different source; refused without --force.
      await writeFile(sf, dump({
        schema: 'school.word-ladder-status/v3',
        words: {
          gawi: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-01', rechecks: 0, lastGraded: null },
          pul: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-21', rechecks: 0, lastGraded: null },
        },
        decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [],
      }));
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
      const forced = load(await readFile(file, 'utf8'));
      expect(forced.blocks.map((b) => b.itemId)).toEqual(['pul', 'gawi']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('quiz --learner migrates a v1 status file and reads it as introduced', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'word-ladder-learner-v1-'));
    try {
      await learnerFixture(root);
      const sf = statusFile(root, 'test-learner', 'korean-vocab');
      await mkdir(path.dirname(sf), { recursive: true });
      await writeFile(sf, dump({ schema: 'school.word-ladder-status/v1', words: { gawi: { state: 'known', step: 2, nextCheckDay: '2026-10-01' } } }));
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-W39', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/korean-vocab-quiz-test-learner-2026-W39.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('quiz --learner throws when nobody has been introduced yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'word-ladder-learner-empty-'));
    try {
      await learnerFixture(root);
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-W39', ...dirs(root)];
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/no introduced words/));
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
