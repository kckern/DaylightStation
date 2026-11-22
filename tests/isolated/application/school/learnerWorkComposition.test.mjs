/**
 * createSchoolLearnerWork — the School composition entry weekly review reads:
 * `{ list({from,to}), image(ref) }` over the lifecycle's own stores, or null
 * when School is not wired.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchoolLearnerWork } from '../../../../__app_modules/learning/school/server/composition/learner-work.mjs';

function recordingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  const logger = { events, info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') };
  logger.child = () => logger;
  return logger;
}

const learners = [{ id: 'kid-a', name: 'Kid A' }];
const schoolLearnerDirectory = { listLearners: () => learners };

function fakeLifecycle() {
  return {
    wired: true,
    stores: {
      bookLog: { listForLearner: async () => [{ id: 'r1', status: 'reading', book: { isbn: '111' }, openedOn: '2026-11-17' }] },
      bookRepository: { findByIsbn: async () => ({ title: 'Owl Moon', authors: ['Jane Yolen'] }) },
      sessions: { listForLearner: async () => [] },
      curriculum: { getUnitSummary: () => null },
      printedActivities: { listForLearner: async () => [] },
    },
  };
}

const ladder = {
  listPackages: () => ['korean-vocab'],
  listDays: () => ['2026-11-18'],
  readDay: () => ({ items: { a: 1 }, doneAt: '2026-11-18T18:00:00Z' }),
};

describe('createSchoolLearnerWork', () => {
  it('lists the week from the lifecycle stores and names card ladder packages', async () => {
    const logger = recordingLogger();
    const mediaBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'school-learner-work-'));
    try {
      const work = createSchoolLearnerWork({
        schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory,
        books: { coverUrlFor: (isbn) => `/covers/${isbn}` },
        worksheetPlatforms: new Map(), cardLadderStore: ladder,
        cardLadderTitleFor: (pkg) => (pkg === 'korean-vocab' ? 'Korean Words' : null),
        renderPdfFirstPagePng: async () => Buffer.from('png'),
        mediaBasePath, rootLogger: logger,
      });
      expect(work).not.toBeNull();
      const { items } = await work.list({ from: '2026-11-16', to: '2026-11-23' });
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.every((i) => i.learnerId === 'kid-a')).toBe(true);
      expect(JSON.stringify(items)).toContain('Owl Moon');
      expect(JSON.stringify(items)).toContain('Korean Words');
      expect(await work.image('bogus')).toBeNull();
      expect(logger.events.some((e) => e.event === 'school.learner-work.wired')).toBe(true);
    } finally {
      fs.rmSync(mediaBasePath, { recursive: true, force: true });
    }
  });

  it('reads the card ladder through its read-only view', async () => {
    let viewed = 0;
    const store = {
      readOnlyView: () => { viewed += 1; return ladder; },
      listPackages: () => { throw new Error('read the live store'); },
      listDays: () => { throw new Error('read the live store'); },
      readDay: () => { throw new Error('read the live store'); },
    };
    const work = createSchoolLearnerWork({
      schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory, cardLadderStore: store,
      cardLadderTitleFor: () => 'Korean Words', mediaBasePath: '/unused', rootLogger: recordingLogger(),
    });
    expect(viewed).toBe(1);
    const { items } = await work.list({ from: '2026-11-16', to: '2026-11-23' });
    expect(items.some((i) => i.kind === 'program' && i.title === 'Korean Words')).toBe(true);
  });

  it.each([undefined, '', '   '])('keeps list() working without a media base path (%j)', async (mediaBasePath) => {
    const logger = recordingLogger();
    const work = createSchoolLearnerWork({
      schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory, cardLadderStore: ladder,
      mediaBasePath, rootLogger: logger,
    });
    expect(work).not.toBeNull();
    const { items } = await work.list({ from: '2026-11-16', to: '2026-11-23' });
    expect(items.length).toBeGreaterThan(0);
    expect(await work.image('activity:none')).toBeNull();
    expect(logger.events.find((e) => e.event === 'school.learner-work.no-image-cache')?.level).toBe('warn');
    expect(logger.events.some((e) => e.event === 'school.learner-work.wiring-failed')).toBe(false);
  });

  it('wires piano lessons and the sentence ladder with household study days', async () => {
    const logger = recordingLogger();
    const learningEvidence = {
      listEvidence: () => [{
        evidenceId: 'e1', learnerId: 'kid-a', occurredAt: '2026-11-20T01:20:00Z',
        activity: { kind: 'piano_lesson' }, learning: { courseId: 'plex:694771', lessonId: 'plex:694833' },
      }],
    };
    const lessonSittingLog = { list: () => [{ plexId: 'plex:694833', title: 'Lesson 50 | Jingle Bells', score: 87.654 }] };
    const languageStudyStore = {
      listCorpusIds: () => ['glossika-korean'],
      readCorpus: () => { throw new Error('must use the service label'); },
      readEventDay: (u, c, day) => (day === '2026-11-21' ? [{ at: '2026-11-21T03:41:09Z', seq: 176 }] : []),
    };
    const languageStudyService = { listCourses: () => [{ id: 'glossika-korean', label: 'Glossika Korean' }] };
    const configService = { getTimezone: () => 'America/Los_Angeles' };
    const work = createSchoolLearnerWork({
      schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory, learningEvidence, lessonSittingLog,
      pianoCourseTitleFor: async () => 'Piano Adventures', languageStudyStore, languageStudyService, configService,
      mediaBasePath: '/unused', rootLogger: logger,
    });
    const { items } = await work.list({ from: '2026-11-16', to: '2026-11-23' });
    expect(items.find((i) => i.groupKey === 'course:plex:694771')).toMatchObject({
      title: 'Piano Adventures', subtitle: 'Lesson 50 · Jingle Bells', studyDay: '2026-11-19',
    });
    expect(items.find((i) => i.groupKey === 'program:sentence-ladder:glossika-korean')).toMatchObject({
      title: 'Glossika Korean', subtitle: '1 sentence', studyDay: '2026-11-20',
    });
    expect(JSON.stringify(items)).not.toContain('87.654');
    const wired = logger.events.find((e) => e.event === 'school.learner-work.wired');
    expect(wired.data.sources).toEqual(expect.arrayContaining(['pianoLessons', 'sentenceLadder']));
  });

  it('tolerates the piano and sentence ladder deps being absent', async () => {
    const logger = recordingLogger();
    const work = createSchoolLearnerWork({ schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory, mediaBasePath: '/unused', rootLogger: logger });
    const { items } = await work.list({ from: '2026-11-16', to: '2026-11-23' });
    expect(items.every((i) => i.kind === 'book')).toBe(true);
    const wired = logger.events.find((e) => e.event === 'school.learner-work.wired');
    expect(wired.data.sources).not.toContain('pianoLessons');
    expect(wired.data.sources).not.toContain('sentenceLadder');
  });

  it('is null when School is not wired', () => {
    const logger = recordingLogger();
    expect(createSchoolLearnerWork({ schoolLifecycle: null, schoolLearnerDirectory, rootLogger: logger })).toBeNull();
    expect(createSchoolLearnerWork({ schoolLifecycle: { wired: false }, schoolLearnerDirectory, rootLogger: logger })).toBeNull();
  });

  it('logs and returns null when wiring throws', () => {
    const logger = recordingLogger();
    const work = createSchoolLearnerWork({
      schoolLifecycle: fakeLifecycle(), schoolLearnerDirectory: null, mediaBasePath: '/tmp/x', rootLogger: logger,
    });
    expect(work).toBeNull();
    expect(logger.events.some((e) => e.event === 'school.learner-work.wiring-failed')).toBe(true);
  });
});
