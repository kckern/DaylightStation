// @vitest-environment node
/**
 * `GET /self-service/learners/:learnerId/next` with the economy wired: the
 * sheet names what it is worth. Real School (`IssueSubjectNext` over the
 * committed fixture curriculum, the self-service router) and real Economy
 * (`createEconomyApi` + `createEconomyEarningsRuntime`, the earn rules and the
 * catalog on a temp dir), joined the way `lifecycle-runtime.mjs` joins them:
 * School holds `economyApi.rewardFor`, bound after School by the earnings
 * runtime. Only the term grid's verdicts and the ring standings are stand-ins.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolSelfServiceRouter } from "../../../../__app_modules/learning/school/server/api/school.selfservice.mjs";
import { IssueSubjectNext } from "../../../../__app_modules/learning/school/server/application/usecases/IssueSubjectNext.mjs";
import { ResolveSubjectNext } from "../../../../__app_modules/learning/school/server/application/usecases/ResolveSubjectNext.mjs";
import { GetLearnerDayCompletion } from "../../../../__app_modules/learning/school/server/application/GetLearnerDayCompletion.mjs";
import { PlanProjection } from "../../../../__app_modules/learning/school/server/application/PlanProjection.mjs";
import { CurriculumAccess } from "../../../../__app_modules/learning/school/server/application/CurriculumAccess.mjs";
import { createEconomyApi } from "../../../../__app_modules/money/economy/server/composition/economyApi.mjs";
import { createEconomyEarningsRuntime } from "../../../../__app_modules/money/economy/server/composition/earnings.mjs";
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, fakeClock, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT } from '#testlib/school/lifecycleFixtures.mjs';

const BASE = '/api/v1/school/self-service';
const NOW = '2026-07-27T09:00:00.000Z'; // a Monday; study day 2026-07-27 in UTC
const TODAY = '2026-07-27';
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } });

let dir;
afterEach(() => { vi.useRealTimers(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

/** The real completion view, with math read as an elective (`excused`) today when asked. */
const electiveToday = (completion, on) => (on ? {
  execute: async (args) => {
    const view = await completion.execute(args);
    return { ...view, sections: (view?.sections ?? []).map((s) => (s.subject === 'math' ? { ...s, state: 'excused', reason: 'elective_only' } : s)) };
  },
} : completion);

function school({ rewardFor, electiveMath = false }) {
  const clock = fakeClock(NOW);
  const catalog = new FakeCatalog({
    units: rawUnits({ [WORKSHEET_UNIT]: { courseId: undefined, sequence: undefined } }),
    documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [],
    surfaceValidators: () => new Map(), clock: clock.epoch, logger: silentLogger,
  });
  const sessions = new FakeSessionRepository();
  const assignments = new FakeAssignmentStore([{ learnerId: 'kid1', units: [WORKSHEET_UNIT] }]);
  const launchers = new Map();
  const planProjection = new PlanProjection({ curriculum, assignments, sessions, launchers, clock: clock.now, logger: silentLogger });
  return new IssueSubjectNext({
    resolveSubjectNext: new ResolveSubjectNext({
      planProjection, curriculum, assignments, sessions, launchers,
      clock: clock.now, newSessionId: sequentialIds(), logger: silentLogger,
    }),
    getLearnerDayCompletion: electiveToday(new GetLearnerDayCompletion({
      planProjection, curriculum, assignments, sessions, launchers, clock: clock.now, logger: silentLogger,
    }), electiveMath),
    issueDocument: { canIssueBank: () => false, execute: vi.fn() },
    roster: () => [{ id: 'kid1' }],
    rewardFor,
    clock: clock.now,
    logger: silentLogger,
  });
}

const MATH_DAILY = { id: 'math-daily', label: 'Math (each day done)', kind: 'section-day', match: { subject: 'math' }, reward: { silver: 2, gems: 0 } };
const GREEN_DAY = { id: 'green-day', label: 'Green day', kind: 'day-met', match: {}, reward: { silver: 1, gems: 0 } };

async function economy({ mode, mathToday, rules }) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-reward-'));
  fs.mkdirSync(path.join(dir, 'economy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'economy', 'earn-rules.yml'), yaml.dump({
    revision: 1, currency: 'silver', users: {},
    rules,
  }));
  const configService = {
    getUserProfile: (id) => (id === 'kid1' ? { id } : null),
    getUserDir: (id) => path.join(dir, id),
    getHouseholdAppConfig: () => ({ mode }),
    getHouseholdPath: (rel) => path.join(dir, rel ?? ''),
    getDataDir: () => dir,
  };
  const economyApi = createEconomyApi({ configService, logger: quiet(), timezone: 'UTC', processTimezone: 'UTC' });
  const schoolLifecycle = {
    termVerdicts: {
      read: async () => ({
        term: { from: '2026-07-01', to: '2026-12-31' },
        days: [{ studyDay: TODAY, state: 'partial', sections: [{ subject: 'math', state: mathToday }] }],
        weeks: [{ weekId: TODAY, state: 'unknown', open: true }],
      }),
    },
    listLearnerSessions: { execute: async () => [] },
  };
  return { economyApi, schoolLifecycle };
}

async function getNext({ mode = 'live', mathToday = 'obligated', rules = [MATH_DAILY, GREEN_DAY], electiveMath = false } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const { economyApi, schoolLifecycle } = await economy({ mode, mathToday, rules });
  // School first, holding the late-bound port — the app's order.
  const issueSubjectNext = school({ rewardFor: economyApi.rewardFor, electiveMath });
  await createEconomyEarningsRuntime({
    schoolLifecycle, economyApi,
    fitnessRings: { standings: async () => [] },
    schoolLearnerDirectory: { listLearners: async () => [{ id: 'kid1' }] },
    measuresTimezone: 'UTC',
    rootLogger: quiet(),
  });
  const app = express();
  app.use(BASE, createSchoolSelfServiceRouter({ resolveAccessCode: { resolve: vi.fn(), execute: vi.fn() }, issueSubjectNext }));
  app.use(errorHandlerMiddleware());
  return request(app).get(`${BASE}/learners/kid1/next`);
}

describe('GET /learners/:learnerId/next, economy wired', () => {
  it('a section-day rule still open today: the sheet says what it is worth', async () => {
    const response = await getNext();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ subject: 'math', unit: { unitId: WORKSHEET_UNIT, subject: 'math' }, printable: true });
    expect(response.body.reward).toEqual({ silver: 2, gems: 0 });
  });

  it('today\'s section already served: no amount', async () => {
    const response = await getNext({ mathToday: 'served' });
    expect(response.status).toBe(200);
    expect(response.body.reward).toBeNull();
  });

  it('a unit rule matched on the unit id School\'s unitView reports: its per-unit price', async () => {
    const prefix = WORKSHEET_UNIT.split('.')[0];
    const rules = [GREEN_DAY, { id: 'fraction-sheets', label: 'Fraction sheets', kind: 'unit', match: { subject: 'math', unitId: prefix }, reward: { silver: 1, gems: 1 } }];
    const response = await getNext({ rules });
    expect(response.status).toBe(200);
    expect(response.body.reward).toEqual({ silver: 1, gems: 1 });
    // The same rule keyed by a course: the unit view names none, so no amount.
    const byCourse = [GREEN_DAY, { ...rules[1], match: { courseId: prefix } }];
    expect((await getNext({ rules: byCourse })).body.reward).toBeNull();
  });

  it('an elective unit, through School\'s real unitView: no amount, even under a unit rule', async () => {
    const prefix = WORKSHEET_UNIT.split('.')[0];
    const rules = [{ id: 'fraction-sheets', label: 'Fraction sheets', kind: 'unit', match: { subject: 'math', unitId: prefix }, reward: { silver: 1, gems: 0 } }];
    const response = await getNext({ rules, electiveMath: true });
    expect(response.status).toBe(200);
    expect(response.body.unit).toMatchObject({ unitId: WORKSHEET_UNIT, elective: true });
    expect(response.body.reward).toBeNull();
  });

  it('dry-run: no amount, the coins are not real yet', async () => {
    const response = await getNext({ mode: 'dry-run' });
    expect(response.status).toBe(200);
    expect(response.body.unit?.unitId).toBe(WORKSHEET_UNIT);
    expect(response.body.reward).toBeNull();
  });
});
