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

describe('dismissQuizRequest (reason delivered as a note — advocacy A5)', () => {
  const notes = () => ({ entries: [], append: vi.fn(async function a(e) { this.entries.push(e); }) });

  it('gate-checked: refusal propagates and nothing is written', async () => {
    const gate = { assert: vi.fn(() => { throw new GuestForbiddenError('no'); }) };
    const store = ds();
    const svc = makeService({ teacherGate: gate, datastore: store });
    await expect(svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', pin: 'x', reason: 'r' }))
      .rejects.toThrow(GuestForbiddenError);
    expect(store.saveQuizRequests).not.toHaveBeenCalled();
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: 'x', action: 'quizrequests.dismiss' });
  });

  it('a missing reason is refused — the child is told why, always', async () => {
    const svc = makeService({ teacherGate: { assert: () => {} } });
    await expect(svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern' }))
      .rejects.toThrow(/reason/);
  });

  it('removes the entry AND delivers the reason to the child', async () => {
    const noteStore = notes();
    const svc = new SchoolService({
      datastore: ds(), userService: users, logger: silent, now: () => 1000,
      teacherGate: { assert: () => {} }, teacherNotesRef: () => noteStore,
    });
    await expect(svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', pin: '1', reason: 'We will do this one together next week' }))
      .resolves.toEqual({ dismissed: true });
    expect(saved).toEqual([requests[1]]);
    expect(noteStore.append).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'felix', from: 'kckern',
      note: expect.stringContaining('We will do this one together next week'),
    }));
  });

  it('dismisses EXACTLY the addressed row — a retake and a flag on the same bank survive (M7 fix)', async () => {
    requests = [
      { at: 't', userId: 'felix', unitId: 'plex:123', materialId: 'm1', unitTitle: 'Ep 1' },
      { at: 't', kind: 'retake', userId: 'felix', bankId: 'caps' },
      { at: 't', kind: 'flag', userId: 'felix', bankId: 'caps', sessionId: 'ses_1', note: 'marked wrong' },
    ];
    const svc = makeService({ teacherGate: { assert: () => {} } });
    await expect(svc.dismissQuizRequest({ kind: 'flag', bankId: 'caps', sessionId: 'ses_1', userId: 'felix', dismissedBy: 'kckern', reason: 'Checked — the key is right' }))
      .resolves.toEqual({ dismissed: true });
    expect(saved.map((r) => r.kind ?? 'quiz')).toEqual(['quiz', 'retake']); // ONLY the flag went
    // …and the legacy quiz row (no kind field) is addressable with kind:null.
    requests = saved; saved = null;
    await svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', reason: 'r' });
    expect(saved.map((r) => r.kind)).toEqual(['retake']);
  });

  it('the note is written BEFORE the row is removed — a failed note keeps the row (M7 fix)', async () => {
    const store = ds();
    const broken = { append: vi.fn(async () => { throw new Error('notes volume offline'); }) };
    const svc = new SchoolService({
      datastore: store, userService: users, logger: silent, now: () => 1000,
      teacherGate: { assert: () => {} }, teacherNotesRef: () => broken,
    });
    await expect(svc.dismissQuizRequest({ unitId: 'plex:123', userId: 'felix', dismissedBy: 'kckern', reason: 'r' }))
      .rejects.toThrow('notes volume offline');
    expect(store.saveQuizRequests).not.toHaveBeenCalled(); // the child's row survives
  });

  it('an unknown entry answers dismissed:false without writing', async () => {
    const store = ds();
    const svc = makeService({ teacherGate: { assert: () => {} }, datastore: store });
    await expect(svc.dismissQuizRequest({ unitId: 'plex:404', userId: 'felix', dismissedBy: 'kckern', reason: 'r' }))
      .resolves.toEqual({ dismissed: false });
    expect(store.saveQuizRequests).not.toHaveBeenCalled();
  });
});

describe('flagConcern (kid-safe "this seems wrong" — advocacy wave 7)', () => {
  it('files a kind:flag row with the kid\'s words; dedupes; guests refused', () => {
    const svc = makeService();
    expect(svc.flagConcern({ userId: 'felix', bankId: 'caps', sessionId: 'ses_1', title: 'Caps', note: 'It marked Olympia wrong!' }))
      .toEqual({ flagged: true, duplicate: false });
    expect(saved.at(-1)).toMatchObject({ kind: 'flag', userId: 'felix', bankId: 'caps', note: 'It marked Olympia wrong!' });
    requests = saved;
    expect(svc.flagConcern({ userId: 'felix', bankId: 'caps', sessionId: 'ses_1' }))
      .toEqual({ flagged: true, duplicate: true });
    expect(() => svc.flagConcern({ userId: null, bankId: 'x' })).toThrow(GuestForbiddenError);
  });
});

describe('requestRetake (kid-safe — advocacy A2)', () => {
  it('a signed-in kid files a retake row; guests are refused; dedupe holds', () => {
    const svc = makeService();
    expect(svc.requestRetake({ userId: 'felix', bankId: 'science/pokemon-basics/01-quiz', title: 'Pokemon Basics Quiz' }))
      .toEqual({ requested: true, duplicate: false });
    expect(saved.at(-1)).toMatchObject({ kind: 'retake', userId: 'felix', bankId: 'science/pokemon-basics/01-quiz' });
    requests = saved;
    expect(svc.requestRetake({ userId: 'felix', bankId: 'science/pokemon-basics/01-quiz' }))
      .toEqual({ requested: true, duplicate: true });
    expect(() => svc.requestRetake({ userId: null, bankId: 'x' })).toThrow(GuestForbiddenError);
  });
});
