/**
 * LanguageProgramLauncher (Task 8, design §IProgramLauncher; Task 12 routes
 * LanguageProgramLauncher's launch through DoNow).
 *
 * `PortalDispatch` — the un-occupancy-checked broadcast this file used to
 * unit-test directly — is deleted (Task 13): `donow` is now the household's
 * unconditionally-wired dispatch facade, and `ResolveScanAction#onScreen`'s
 * bank hand-off (and every program launcher) routes through it instead.
 * LanguageProgramLauncher is the thinnest possible adapter: status() passes
 * through LanguageStudyService.todayStatus, launch() asks `DoNowService` to
 * dispatch a fixed 'language' program target on the `portal` surface — so a
 * mid-quiz sibling on the Portal is protected by the same occupancy/override
 * policy any other DoNow caller gets (spec §6 last bullet).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageProgramLauncher } from '#apps/school/LanguageProgramLauncher.mjs';
import { LanguageStudyService } from '#apps/school/LanguageStudyService.mjs';

describe('LanguageProgramLauncher', () => {
  it('has the id "language"', () => {
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, donow: { dispatch: vi.fn() },
    });
    expect(launcher.id).toBe('language');
  });

  // The one program this wording is actually true for — the ladder always
  // dispatches to the `portal` surface (see the `launch()` test below).
  it('reports locationHint "on the Portal"', () => {
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, donow: { dispatch: vi.fn() },
    });
    expect(launcher.locationHint).toBe('on the Portal');
  });

  it('status() passes through LanguageStudyService.todayStatus verbatim', async () => {
    const canned = { doneToday: true, progressLabel: 'Day 3', score: null };
    const languageStudyService = { todayStatus: vi.fn().mockReturnValue(canned) };
    const launcher = new LanguageProgramLauncher({ languageStudyService, donow: { dispatch: vi.fn() } });

    const status = await launcher.status({ userId: 'kid1' });

    expect(status).toEqual(canned);
    expect(languageStudyService.todayStatus).toHaveBeenCalledWith({ userId: 'kid1', corpusId: null });
  });

  it('status() scopes the read to the configured program instance', async () => {
    const languageStudyService = { todayStatus: vi.fn().mockReturnValue({ doneToday: false }) };
    const launcher = new LanguageProgramLauncher({ languageStudyService, donow: { dispatch: vi.fn() } });

    await launcher.status({ userId: 'kid1', programInstance: 'test-spanish' });

    expect(languageStudyService.todayStatus).toHaveBeenCalledWith({
      userId: 'kid1', corpusId: 'test-spanish',
    });
  });

  it('launch() dispatches the fixed language program target through DoNow, and returns its result', async () => {
    const canned = { decision: 'dispatched', message: 'Starting the Portal now.' };
    const donow = { dispatch: vi.fn().mockResolvedValue(canned) };
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, donow,
    });

    const result = await launcher.launch({ userId: 'kid1' });

    expect(result).toEqual(canned);
    expect(donow.dispatch).toHaveBeenCalledWith({
      surface: 'portal',
      action: { target: { kind: 'program', program: 'language' } },
      learnerId: 'kid1',
      requestedBy: 'school-program',
      ref: 'language',
      programId: 'language',
    });
  });

  // The busy policy this exists to prevent: a sibling mid-quiz on the Portal
  // must never be clobbered by a language dispatch — DoNow's occupancy
  // check pends instead of broadcasting, and the launcher must hand that
  // decision straight back rather than reporting a bare boolean.
  it('an occupied-by-other portal pends rather than broadcasting', async () => {
    const donow = {
      dispatch: vi.fn().mockResolvedValue({
        decision: 'pending_approval', approvalId: 'dnr_1', message: 'The Portal is busy — we asked a grown-up.',
      }),
    };
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, donow,
    });

    const result = await launcher.launch({ userId: 'kid1' });

    expect(result.decision).toBe('pending_approval');
    expect(result.decision).not.toBe('dispatched');
  });
});

// -- LanguageStudyService.todayStatus -----------------------------------
// Reuses the fixture/datastore arrangement from LanguageStudyService.test.mjs
// (fake datastore, single test-korean corpus) rather than inventing a new one.

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  audio_base: 'audio/language/test-korean',
  sentences: [
    { seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } },
    { seq: 2, text: { EN: "I'm not rich.", KR: '저는 부자가 아니예요.' } },
    { seq: 3, text: { EN: "This bag's heavy.", KR: '이 가방은 무거워요.' } },
  ],
};

class FakeDatastore {
  constructor() {
    this.corpora = new Map([['test-korean', CORPUS]]);
    this.progress = new Map();
    this.events = new Map();
    this.recordings = new Map();
    this.written = [];
  }

  #key(userId, corpusId) { return `${userId}::${corpusId}`; }

  listCorpusIds() { return [...this.corpora.keys()]; }
  readCorpus(id) { return this.corpora.get(id) ?? null; }

  readProgress(u, c) { return this.progress.get(this.#key(u, c)) ?? null; }
  writeProgress(u, c, p) { this.progress.set(this.#key(u, c), p); return p; }

  appendEvent(u, c, e) {
    const k = this.#key(u, c);
    if (!this.events.has(k)) this.events.set(k, []);
    this.events.get(k).push(e);
    return e;
  }

  readAllEvents(u, c) { return this.events.get(this.#key(u, c)) ?? []; }

  writeRecording(c, u, seq, lang, buffer, ext) {
    const p = `${c}/${u}/${seq}-${lang}.${ext}`;
    this.recordings.set(`${Number(seq)}-${lang}`, buffer);
    this.written.push({ path: p, size: buffer.length });
    return p;
  }

  listRecordingKeys() { return new Set(this.recordings.keys()); }
  resolveAudioPath(c, seq, lang) { return `/media/${c}/${seq}-${lang}.mp3`; }
  resolveRecordingPath(c, u, seq, lang, ext) { return `/media/${c}/rec/${u}/${seq}-${lang}.${ext}`; }
}

const AT = Date.parse('2026-07-21T10:00:00Z');

function makeService(ds, now = AT) {
  return new LanguageStudyService({
    datastore: ds,
    now: () => (typeof now === 'function' ? now() : now),
    timezone: 'UTC',
    logger: { warn() {}, info() {}, debug() {} },
  });
}

describe('LanguageStudyService.todayStatus', () => {
  let ds; let svc;
  beforeEach(() => { ds = new FakeDatastore(); svc = makeService(ds); });

  it('reports doneToday:false with a Day N label on a fresh, untouched day', () => {
    // Pacing set (progress exists) but nothing logged yet today.
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 3 });
    const status = svc.todayStatus({ userId: 'kckern' });
    expect(status).toEqual({ doneToday: false, progressLabel: 'Day 1', score: null });
  });

  it('reports doneToday:true once every queued item for today is cleared', () => {
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 1 });
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    const status = svc.todayStatus({ userId: 'kckern' });
    expect(status).toEqual({ doneToday: true, progressLabel: 'Day 1', score: null });
  });

  it('a day completed on a PRIOR study day reports the rolled day, never done today', () => {
    // Found live (felix, 2026-07-30): day 1 cleared on July 22, the app never
    // reopened, so the stored day stayed 1 and todayStatus reported the
    // long-finished day as "done today" — hiding the subject on the agenda.
    // The stored day only advances when the learner next opens the app, so
    // todayStatus must apply the same rollover the live session applies.
    ds.appendEvent('kckern', 'test-korean', {
      at: '2026-07-13T10:00:00Z', day: 1, seq: 1, rung: 'repetition', attributedTo: 'kckern',
    });
    ds.writeProgress('kckern', 'test-korean', {
      corpus: 'test-korean', day: 1, daily_limit: 1, last_activity: '2026-07-13T10:00:00Z',
    });

    const status = svc.todayStatus({ userId: 'kckern' }); // now = 2026-07-21
    expect(status).toEqual({ doneToday: false, progressLabel: 'Day 2', score: null });
  });

  it('reports the null triple for a learner with no corpus/progress at all', () => {
    const status = svc.todayStatus({ userId: 'brand-new-kid' });
    expect(status).toEqual({ doneToday: false, progressLabel: null, score: null });
  });

  it('does not borrow status from a different corpus when one is requested', () => {
    ds.corpora.set('test-spanish', { ...CORPUS, id: 'test-spanish', label: 'Test Spanish' });
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 1 });
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });

    expect(svc.todayStatus({ userId: 'kckern', corpusId: 'test-spanish' })).toEqual({
      doneToday: false, progressLabel: null, score: null,
    });
    expect(svc.todayStatus({ userId: 'kckern', corpusId: 'test-korean' })).toEqual({
      doneToday: true, progressLabel: 'Day 1', score: null,
    });
  });

  it('reports doneToday:true / "Course complete" when the corpus was fully retired on a prior day', () => {
    // An empty queue counts as complete (rollover.mjs:45-46) — a learner who
    // has climbed the whole ladder on every sentence must not be told they
    // still have a "Day N" pending forever.
    const RUNG_ORDER = ['repetition', 'dictation', 'recording', 'interpretation'];
    for (const seq of [1, 2, 3]) {
      RUNG_ORDER.forEach((rung, i) => {
        ds.appendEvent('kckern', 'test-korean', {
          at: `2026-07-0${i + 1}T00:00:00Z`, day: i + 1, seq, rung, attributedTo: 'kckern',
        });
      });
    }
    ds.writeProgress('kckern', 'test-korean', {
      corpus: 'test-korean', day: 10, daily_limit: 5, last_activity: '2026-07-04T00:00:00Z',
    });

    const status = svc.todayStatus({ userId: 'kckern' });
    expect(status).toEqual({ doneToday: true, progressLabel: 'Course complete', score: null });
  });

  it('never throws — a datastore failure yields the null triple', () => {
    const throwingDs = { listCorpusIds() { throw new Error('datastore unavailable'); } };
    const brokenSvc = new LanguageStudyService({
      datastore: throwingDs,
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });

    const status = brokenSvc.todayStatus({ userId: 'kckern' });
    expect(status).toEqual({ doneToday: false, progressLabel: null, score: null });
  });
});
