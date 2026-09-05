/**
 * Reading shelf — one composed, durable journey.
 *
 * This is deliberately below HTTP and above the individual unit tests. It
 * runs the production collaborators in the order the two routers call them:
 *
 *   access code -> launch card -> program action -> signed book grant
 *     -> ISBN resolution/cache -> shelf open + finish -> shelf projection
 *     -> append-only correction -> shelf projection
 *
 * Express contract tests separately prove header/path/body translation. This
 * test owns the seam they cannot: all the application methods agree on one
 * learner, one canonical ISBN, one item id, one study day and one obligation,
 * and the resulting evidence survives a fresh adapter read from disk.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';
import { ResolveBook } from '#apps/books/ResolveBook.mjs';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { RunSelfServiceAction } from '#apps/school/usecases/RunSelfServiceAction.mjs';
import { OpenBookShelfItem } from '#apps/school/usecases/OpenBookShelfItem.mjs';
import { GetBookShelf } from '#apps/school/usecases/GetBookShelf.mjs';
import { RecordBookProgress } from '#apps/school/usecases/RecordBookProgress.mjs';
import { BookLogProgramLauncher } from '#apps/school/BookLogProgramLauncher.mjs';
import { HmacSchoolBookGrantIssuer } from '#adapters/school/actions/HmacSchoolBookGrantIssuer.mjs';
import { YamlBookLogStore } from '#adapters/persistence/yaml/YamlBookLogStore.mjs';
import { YamlBookRepository } from '#adapters/persistence/yaml/YamlBookRepository.mjs';

const LEARNER_ID = 'user_4';
const ISBN = '9780064400558';
const ACCESS_CODE = '482913';
const NOW = '2026-09-03T18:00:00.000Z';
const STUDY_DAY = '2026-09-03';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function assignment() {
  return {
    learnerId: LEARNER_ID,
    courses: [],
    units: [],
    programs: [{
      programId: 'book-log',
      subject: 'english',
      title: 'Reading',
      obligation: { metric: 'checkins', quantity: 1, per: 'day' },
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    }],
  };
}

describe('reading shelf composed journey', () => {
  it('turns User_4\'s English code and ISBN into one durable finished book, then safely undoes it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'daylight-reading-shelf-'));
    try {
      const clock = () => new Date(NOW);
      const configService = {
        getHouseholdPath(suffix = '') { return path.join(root, suffix); },
      };
      const assignments = { async get(learnerId) {
        return learnerId === LEARNER_ID ? assignment() : null;
      } };
      const bookLog = new YamlBookLogStore({ configService, clock, logger: silent });
      const bookRepository = new YamlBookRepository({ configService, clock, logger: silent });
      const grants = new HmacSchoolBookGrantIssuer({
        key: 'reading-shelf-flow-test-key-has-more-than-thirty-two-bytes',
        clock: () => Date.parse(NOW),
      });
      const launcher = new BookLogProgramLauncher({
        assignments, bookLog, timezone: 'UTC', clock, grants, logger: silent,
      });

      // A real English lesson sorts first. The token explicitly names the
      // independent book-log program, so the panel must not silently route
      // User_4 into the curriculum sibling merely because both say English.
      const englishLesson = {
        unitId: 'english-lesson-1', title: 'English Lesson 1', subject: 'english',
        status: 'available', program: null, sessionId: null,
      };
      const plan = appendAssignedProgramEntries(
        { entries: [englishLesson], errors: [] },
        assignment(),
      );
      const planProjection = {
        async project() {
          const status = await launcher.status({ userId: LEARNER_ID });
          return {
            plan,
            sections: [{ subject: 'english', servedToday: false, next: plan.entries[0], progressRows: [] }],
            activeExceptions: [],
            programStatuses: [{ programId: 'book-log', programInstance: 'shelf', status }],
            projection: {
              assignment: assignment(), units: [englishLesson], sessions: [], works: [], nowIso: NOW,
            },
          };
        },
      };
      const tokens = { async getByAccessCode(code) {
        return code === ACCESS_CODE
          ? {
            tokenClass: 'subject_next',
            subject: {
              learnerId: LEARNER_ID, subject: 'english', program: 'book-log', continueToday: true,
            },
          }
          : null;
      } };
      const curriculum = {
        async listUnits() { return [englishLesson]; },
        async listWorks() { return []; },
      };
      const sessions = {
        async listForLearner() { return []; },
        async readEvents() { return []; },
      };
      const resolveAccessCode = new ResolveAccessCode({
        tokens, curriculum, assignments, sessions, planProjection, clock, logger: silent,
      });

      // POST /school/self-service/resolve
      const card = await resolveAccessCode.execute({ code: ACCESS_CODE });
      expect(card).toMatchObject({ ok: true, learner: LEARNER_ID, subject: 'english' });
      expect(card.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'program', target: 'book-log' }),
      ]));

      // POST /school/self-service/act
      const runAction = new RunSelfServiceAction({
        resolveAccessCode,
        sessions,
        launchers: new Map([['book-log', launcher]]),
        clock,
        logger: silent,
      });
      const mounted = await runAction.execute({ code: ACCESS_CODE, action: 'program' });
      expect(mounted).toMatchObject({
        outcome: 'mount', transition: 'mount',
        effect: { kind: 'program', program: 'book-log', learnerId: LEARNER_ID },
      });
      expect(grants.verify(mounted.effect.bookGrant, { learnerId: LEARNER_ID }))
        .toMatchObject({ ok: true, payload: { learnerId: LEARNER_ID } });

      const gateway = {
        id: 'catalogue-fixture',
        async byIsbn(isbn13) {
          expect(isbn13).toBe(ISBN);
          return createBookRecord({
            source: 'catalogue-fixture',
            isbn13,
            title: 'The Wild Robot [electronic resource]',
            subtitle: 'Escapes&nbsp;again',
            authors: ['Brown, Peter', 'Peter Brown', 'Jane Illustrator', 'A. Translator'],
            description: '<p>A robot &amp; her friends.</p>',
            pageCount: 288,
            coverUrl: 'https://covers.example.test/wild-robot-landscape.jpg',
          });
        },
      };
      const resolveBook = new ResolveBook({
        gateways: [gateway], repository: bookRepository, clock, logger: silent,
      });

      // GET /books/resolve?id=<ISBN>
      const resolved = await resolveBook.execute(ISBN);
      expect(resolved).toMatchObject({
        status: 'ok',
        book: {
          isbn13: ISBN,
          title: 'The Wild Robot [electronic resource]',
          subtitle: 'Escapes&nbsp;again',
          authors: ['Brown, Peter', 'Peter Brown', 'Jane Illustrator', 'A. Translator'],
          pageCount: 288,
        },
      });

      const openBook = new OpenBookShelfItem({
        bookLog, resolveBook, clock, dayOf: (iso) => launcher.dayOf(iso), logger: silent,
      });
      const getShelf = new GetBookShelf({
        bookLog, bookRepository, bookLogLauncher: launcher, clock, logger: silent,
      });
      const progress = new RecordBookProgress({
        bookLog, clock, dayOf: (iso) => launcher.dayOf(iso), logger: silent,
      });

      // POST /school/books/user_4/shelf — the "already finished" door. The
      // repeated call represents a double tap/retry with identical entry ids.
      const openArgs = {
        learnerId: LEARNER_ID,
        bookId: ISBN,
        entryId: 'open-wild-robot',
        progressEntryId: 'finish-wild-robot',
        where: 'finished',
        finishedOn: STUDY_DAY,
      };
      const opened = await openBook.execute(openArgs);
      await openBook.execute(openArgs);

      // GET /school/books/user_4/shelf — shelf/history share this projection.
      const finished = await getShelf.execute({ learnerId: LEARNER_ID });
      expect(finished).toMatchObject({
        learnerId: LEARNER_ID,
        studyDay: STUDY_DAY,
        obligation: { actual: 1, target: 1, metric: 'checkins', met: true, per: 'day' },
        items: [{
          itemId: opened.item.itemId,
          bookId: ISBN,
          title: 'The Wild Robot [electronic resource]',
          subtitle: 'Escapes&nbsp;again',
          authors: ['Brown, Peter', 'Peter Brown', 'Jane Illustrator', 'A. Translator'],
          coverUrl: 'https://covers.example.test/wild-robot-landscape.jpg',
          projection: { status: 'finished', percent: 100, daysRead: 1, lastAt: `${STUDY_DAY}T12:00:00.000Z` },
        }],
      });

      // The retry made no duplicate book/event, and a fresh YAML parse sees
      // exactly the two append-only facts the UI claimed to save.
      const storedLog = yaml.load(readFileSync(
        path.join(root, 'school/records/books', `${LEARNER_ID}.yml`),
        'utf8',
      ));
      expect(storedLog.items).toHaveLength(1);
      expect(storedLog.items[0].events.map((event) => [event.kind, event.entryId]))
        .toEqual([['started', 'open-wild-robot'], ['finished', 'finish-wild-robot']]);
      const storedBook = yaml.load(readFileSync(path.join(root, 'books', `${ISBN}.yml`), 'utf8'));
      expect(storedBook).toMatchObject({ isbn13: ISBN, cachedAt: NOW });

      // POST /school/books/user_4/shelf/:itemId/progress {kind: reopened} is
      // the receipt's "Undo finish" correction. It preserves history while
      // immediately withdrawing completion and today's check-in credit.
      await progress.execute({
        learnerId: LEARNER_ID,
        itemId: opened.item.itemId,
        kind: 'reopened',
        entryId: 'undo-finish-wild-robot',
      });
      const reopened = await getShelf.execute({ learnerId: LEARNER_ID });
      expect(reopened).toMatchObject({
        obligation: { actual: 0, target: 1, met: false },
        items: [{ projection: { status: 'reading', daysRead: 0 } }],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
