import express from 'express';
import { wireRequest } from './http-wire.mjs';
import { loadSchoolHttpTarget } from './school-http-target.mjs';
const implementation = await loadSchoolHttpTarget();
const stamp = '2026-07-27T09:00:00.000Z';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const roster = [{ id: 'kid1', name: 'KID1', birthyear: 2016 }, { id: 'dad', name: 'Papa', birthyear: 1984 }];
export function schoolHttpFixture({ unwired = false } = {}) {
  const calls = { banks: [], sessions: [], answers: [], progress: [], previews: [], builds: [] };
  const writes = [];
  const rows = new Map();
  const { GuestForbiddenError, SessionGoneError, coreErrors, GrownUpGate, SetAssignments,
    SchoolLifecycleAgendaResource, createSchoolApiServices, createSchoolRouter,
    createSchoolLifecycleRouter, errorHandlerMiddleware } = implementation;
  const service = {
    getRoster: () => [{ id: 'kid1', name: 'KID1' }], warmBanks: async () => {},
    listBanks(args) { calls.banks.push(args); return args.audience === 'generic' ? [{ id: 'animals' }] : [{ id: 'animals' }, { id: 'caps' }]; },
    getBank(id) { if (id !== 'caps') throw new coreErrors.EntityNotFoundError('no bank'); return { id, items: [] }; },
    openSession(args) { calls.sessions.push(args); if (args.bankId === 'assigned-bank' && args.userId == null) throw new GuestForbiddenError('no'); if (args.bankId === 'nope') throw new coreErrors.EntityNotFoundError('no bank'); return { sessionId: 'ses_1' }; },
    answer(args) { calls.answers.push(args); if (args.sessionId === 'ses_gone') throw new SessionGoneError('gone'); if (args.selfGrade !== undefined) throw new coreErrors.ValidationError('selfGrade is not accepted on a quiz session'); if (args.sessionId === 'ses_boom') throw new Error('synthetic append failure'); return { correct: true, expected: 'x', attemptId: 'att_1' }; },
    getResults: () => ({ bankId: 'caps' }),
  };
  const assignments = {
    get: async id => rows.get(id) ?? null,
    put: async record => { writes.push(structuredClone(record)); rows.set(record.learnerId, structuredClone(record)); return structuredClone(record); },
  };
  const clock = () => new Date(stamp);
  const grownUps = new GrownUpGate({ roster: () => roster, clock, logger });
  const setAssignments = new SetAssignments({ assignments, grownUps, roster: () => roster,
    curriculum: { listUnits: async () => [{ courseId: 'math-fractions' }] }, clock, logger });
  const lifecycleAgendaResource = new SchoolLifecycleAgendaResource({
    previewAgenda: { execute: async args => { calls.previews.push(args); return { document: { id: 'preview-kid1' } }; } },
    buildAgenda: { execute: async args => { calls.builds.push(args); return { document: { id: 'agenda-kid1' } }; } },
    pngRenderer: { createCanvas: async document => ({ canvas: { toBuffer: () => Buffer.from('png:' + document.id) } }) },
    roster: { displayName: id => roster.find(row => row.id === id)?.name ?? null },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter(unwired ? { logger } : { lifecycleAgendaResource, setAssignments, logger }));
  app.use('/api/v1/school', createSchoolRouter(createSchoolApiServices({
    schoolErrors: { GuestForbiddenError, SessionGoneError }, schoolService: service, logger,
    getMaterialProgressSummary: { execute: async args => { calls.progress.push(args); return args.userId === 'kid1' ? [{ materialId: 'plex:v1', unitsDone: 1, unitTotal: 2, percent: 50 }] : []; } },
  })));
  app.use(errorHandlerMiddleware({ logger }));
  return { calls, writes, rows, target: implementation.target,
    request: (method, path, options) => wireRequest(app, method, '/api/v1/school' + path, options) };
}
export { stamp };
