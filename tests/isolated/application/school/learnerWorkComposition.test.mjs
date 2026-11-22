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
