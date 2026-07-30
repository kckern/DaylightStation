/**
 * PortalDispatch + LanguageProgramLauncher (Task 8, design §IProgramLauncher).
 *
 * PortalDispatch is the one place that knows how to hand a learner off to a
 * program — everything else just describes a target and lets the bus carry
 * it. LanguageProgramLauncher is the thinnest possible adapter: status()
 * passes through LanguageStudyService.todayStatus, launch() asks the portal
 * for a fixed 'language' program target.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalDispatch } from '#apps/school/PortalDispatch.mjs';
import { LanguageProgramLauncher } from '#apps/school/LanguageProgramLauncher.mjs';
import { LanguageStudyService } from '#apps/school/LanguageStudyService.mjs';

describe('PortalDispatch', () => {
  it('broadcasts a school.launch event on the school topic', () => {
    const eventBus = { broadcast: vi.fn() };
    const portal = new PortalDispatch({ eventBus, logger: { info() {}, warn() {} } });

    const target = { kind: 'bank', bankId: 'geo-1', unitId: 'unit-1', sessionId: 'sess-1' };
    const result = portal.launch({ learnerId: 'kid1', target });

    expect(result).toEqual({ dispatched: true });
    expect(eventBus.broadcast).toHaveBeenCalledWith('school', {
      type: 'school.launch',
      learnerId: 'kid1',
      target,
    });
  });

  it('accepts a program target as well as a bank target', () => {
    const eventBus = { broadcast: vi.fn() };
    const portal = new PortalDispatch({ eventBus });
    const target = { kind: 'program', program: 'language' };

    portal.launch({ learnerId: 'kid1', target });

    expect(eventBus.broadcast).toHaveBeenCalledWith('school', {
      type: 'school.launch', learnerId: 'kid1', target,
    });
  });

  it('reports dispatched:false and does not throw when no bus is wired', () => {
    const portal = new PortalDispatch({});
    const result = portal.launch({ learnerId: 'kid1', target: { kind: 'program', program: 'language' } });
    expect(result).toEqual({ dispatched: false });
  });
});

describe('LanguageProgramLauncher', () => {
  it('has the id "language"', () => {
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, portal: { launch: vi.fn() },
    });
    expect(launcher.id).toBe('language');
  });

  it('status() passes through LanguageStudyService.todayStatus verbatim', async () => {
    const canned = { doneToday: true, progressLabel: 'Day 3', score: null };
    const languageStudyService = { todayStatus: vi.fn().mockReturnValue(canned) };
    const launcher = new LanguageProgramLauncher({ languageStudyService, portal: { launch: vi.fn() } });

    const status = await launcher.status({ userId: 'kid1' });

    expect(status).toEqual(canned);
    expect(languageStudyService.todayStatus).toHaveBeenCalledWith({ userId: 'kid1' });
  });

  it('launch() asks the portal for the fixed language program target', async () => {
    const portal = { launch: vi.fn().mockReturnValue({ dispatched: true }) };
    const launcher = new LanguageProgramLauncher({
      languageStudyService: { todayStatus: vi.fn() }, portal,
    });

    const result = await launcher.launch({ userId: 'kid1' });

    expect(result).toEqual({ dispatched: true });
    expect(portal.launch).toHaveBeenCalledWith({
      learnerId: 'kid1', target: { kind: 'program', program: 'language' },
    });
  });
});

// -- LanguageStudyService.todayStatus -----------------------------------
// Reuses the fixture/datastore arrangement from LanguageStudyService.test.mjs
// (fake datastore, single test-korean corpus) rather than inventing a new one.

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/test-korean',
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

  it('reports the null triple for a learner with no corpus/progress at all', () => {
    const status = svc.todayStatus({ userId: 'brand-new-kid' });
    expect(status).toEqual({ doneToday: false, progressLabel: null, score: null });
  });
});
