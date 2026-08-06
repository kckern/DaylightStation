/**
 * Quiz-request lifecycle (teacher-console spec §4.6, teacher.quizrequests.clear):
 * the backlog can shrink two ways — a request auto-fulfils once a bank bound
 * to its unit is authored, and a teacher can dismiss one through the gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const BANK_RAW = {
  id: 'fractions-quiz',
  title: 'Fractions Quiz',
  unit: 'plex:123',
  items: [{ id: 'q1', type: 'multiple_choice', prompt: 'x', choices: ['a', 'b'], answer: 'a' }],
};

let requests;
let saved;
const ds = () => ({
  readAllBankRaws: async () => [{ id: 'fractions-quiz', raw: BANK_RAW }],
  readAllAttempts: () => [],
  readQuizRequests: () => requests,
  saveQuizRequests: vi.fn((next) => { saved = next; }),
});

const users = { getProfile: () => ({ id: 'u1' }), getHouseholdRoster: () => [{ id: 'felix' }] };
const silent = { info() {}, warn() {}, error() {} };

const makeService = ({ teacherGate = null, datastore = ds() } = {}) => new SchoolService({
  datastore, userService: users, logger: silent, now: () => 1000, teacherGate,
});

beforeEach(() => {
  requests = [
    { at: 't', userId: 'felix', unitId: 'plex:123', materialId: 'm1', unitTitle: 'Ep 1' },
    { at: 't', userId: 'milo', unitId: 'plex:999', materialId: 'm1', unitTitle: 'Ep 9' },
  ];
  saved = null;
});

describe('listQuizRequests fulfilled annotation', () => {
  it('marks a request fulfilled once a bank bound to its unit exists', async () => {
    const svc = makeService();
    await svc.warmBanks();
    const list = svc.listQuizRequests();
    expect(list.find((r) => r.unitId === 'plex:123').fulfilled).toBe(true);
    expect(list.find((r) => r.unitId === 'plex:999').fulfilled).toBe(false);
  });

  it('a cold bank cache degrades to fulfilled:false, never a throw', () => {
    const svc = makeService();
    const list = svc.listQuizRequests();
    expect(list.every((r) => r.fulfilled === false)).toBe(true);
  });
});

describe('dismissQuizRequest', () => {
  it('gate-checked: refusal propagates and nothing is written', () => {
    const gate = { assert: vi.fn(() => { throw new GuestForbiddenError('no'); }) };
    const store = ds();
    const svc = makeService({ teacherGate: gate, datastore: store });
    expect(() => svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', pin: 'x' }))
      .toThrow(GuestForbiddenError);
    expect(store.saveQuizRequests).not.toHaveBeenCalled();
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: 'x', action: 'quizrequests.dismiss' });
  });

  it('removes exactly the named unit+user entry', () => {
    const svc = makeService({ teacherGate: { assert: () => {} } });
    expect(svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', pin: '1' }))
      .toEqual({ dismissed: true });
    expect(saved).toEqual([requests[1]]);
  });

  it('an unknown entry answers dismissed:false without writing', () => {
    const store = ds();
    const svc = makeService({ teacherGate: { assert: () => {} }, datastore: store });
    expect(svc.dismissQuizRequest({ unitId: 'plex:404', userId: 'felix', dismissedBy: 'kckern' }))
      .toEqual({ dismissed: false });
    expect(store.saveQuizRequests).not.toHaveBeenCalled();
  });

  it('no gate configured refuses outright', () => {
    const svc = makeService();
    expect(() => svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern' }))
      .toThrow(GuestForbiddenError);
  });
});
