/**
 * LanguageStudyService tests against a fake datastore.
 *
 * The service owns pacing policy and the record contract; the ladder itself is
 * tested in the domain. What matters here is that nothing derivable gets
 * stored, that a guest cannot produce records, and that rollover cannot be
 * rushed by a client.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LanguageStudyService } from './LanguageStudyService.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/test-korean',
  sentences: [
    { seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } },
    { seq: 2, text: { EN: "I'm not rich.", KR: '저는 부자가 아니예요.' } },
    { seq: 3, text: { EN: "This bag's heavy.", KR: '이 가방은 무거워요.' } },
    { seq: 4, text: { EN: 'Please sit here.', KR: '여기 앉으세요.' } },
  ],
};

const EQUIPPED = { microphone: true, textInput: ['EN', 'KR'] };

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

function makeService(ds, now = AT, overrides = {}) {
  return new LanguageStudyService({
    datastore: ds,
    now: () => (typeof now === 'function' ? now() : now),
    timezone: 'UTC',
    logger: { warn() {}, info() {}, debug() {} },
    ...overrides,
  });
}

function makeDue(ds, rung, seq = 1) {
  const chain = ['repetition', 'dictation', 'recording', 'interpretation'];
  const index = chain.indexOf(rung);
  for (let i = 0; i < index; i += 1) {
    ds.appendEvent('kckern', 'test-korean', {
      at: new Date(AT - (index - i) * 86_400_000).toISOString(),
      day: i + 1, seq, rung: chain[i], attributedTo: 'kckern',
    });
  }
  ds.writeProgress('kckern', 'test-korean', {
    corpus: 'test-korean', day: index + 1, daily_limit: 5, last_activity: null,
  });
}

describe('courses', () => {
  it('lists a valid corpus with its role binding', () => {
    const svc = makeService(new FakeDatastore());
    expect(svc.listCourses()).toEqual([
      { id: 'test-korean', label: 'Test Korean', languages: { source: 'EN', target: 'KR' }, size: 4 },
    ]);
  });

  it('omits an invalid corpus rather than serving a broken course', () => {
    const ds = new FakeDatastore();
    ds.corpora.set('broken', { id: 'broken', languages: { source: 'EN', target: 'EN' }, sentences: [] });
    const svc = makeService(ds);
    expect(svc.listCourses().map((c) => c.id)).toEqual(['test-korean']);
  });
});

describe('guest preview', () => {
  it('derives a fresh day without reading or writing learner evidence', () => {
    const ds = new FakeDatastore();
    ds.appendEvent('learner3', 'test-korean', {
      at: new Date(AT).toISOString(), day: 9, seq: 1, rung: 'repetition', attributedTo: 'learner3',
    });
    ds.writeProgress('learner3', 'test-korean', {
      corpus: 'test-korean', day: 9, daily_limit: 1, last_activity: new Date(AT).toISOString(),
    });
    const readProgress = vi.spyOn(ds, 'readProgress');
    const readEvents = vi.spyOn(ds, 'readAllEvents');
    const append = vi.spyOn(ds, 'appendEvent');
    const write = vi.spyOn(ds, 'writeProgress');

    const preview = makeService(ds).previewDay({ corpusId: 'test-korean', capabilities: EQUIPPED });

    expect(preview).toMatchObject({ schema: 'school.sentence-ladder-guest-preview/v1', day: 1, dailyLimit: 5 });
    expect(preview.queue.length).toBeGreaterThan(0);
    expect(readProgress).not.toHaveBeenCalled();
    expect(readEvents).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('guest rule', () => {
  it('refuses every operation without an identified learner', () => {
    const svc = makeService(new FakeDatastore());
    const calls = [
      () => svc.getDay({ userId: null, corpusId: 'test-korean' }),
      () => svc.logAttempt({ userId: null, corpusId: 'test-korean', seq: 1, rung: 'repetition' }),
      () => svc.setPacing({ userId: null, corpusId: 'test-korean', dailyLimit: 5 }),
      () => svc.rollDay({ userId: null, corpusId: 'test-korean' }),
      () => svc.getHistory({ userId: null, corpusId: 'test-korean' }),
    ];
    for (const call of calls) expect(call).toThrow(GuestForbiddenError);
  });
});

describe('getDay', () => {
  let ds; let svc;
  beforeEach(() => { ds = new FakeDatastore(); svc = makeService(ds); });

  it('starts a new learner on day 1 with the default pacing', () => {
    const day = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(day.day).toBe(1);
    expect(day.dailyLimit).toBe(5);
    expect(day.summary.done).toBe(0);
  });

  it('resolves prompt roles to concrete languages so no component hardcodes them', () => {
    const day = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    const first = day.queue[0];
    expect(first.rung).toBe('repetition');
    expect(first.prompt).toEqual([
      { role: 'source', language: 'EN' },
      { role: 'target', language: 'KR' },
      { role: 'target', language: 'KR' },
    ]);
  });

  it('carries the sentence text keyed by language code', () => {
    const day = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(day.queue[0].text).toEqual(CORPUS.sentences[0].text);
  });

  it('marks copy-mode dictation from the enrollment rather than a client choice', () => {
    svc = makeService(ds, AT, {
      readProgramEnrollment: () => ({
        programId: 'sentence-ladder', corpusId: 'test-korean', lessonSize: 1,
        rungs: ['dictation'], dictationMode: 'copy',
      }),
    });
    const day = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(day.enrollment).toMatchObject({ dictationMode: 'copy' });
    expect(day.queue[0]).toMatchObject({ rung: 'dictation', copyPrompt: true });
  });

  it('reports the device-filtered chain', () => {
    const day = svc.getDay({
      userId: 'kckern', corpusId: 'test-korean',
      capabilities: { microphone: false, textInput: ['EN'] },
    });
    expect(day.chain).toEqual(['repetition', 'interpretation']);
  });

  it('never writes a queue to storage — it is derived', () => {
    svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    const stored = ds.readProgress('kckern', 'test-korean');
    expect(stored).toBeNull();
  });

  it('404s an unknown corpus', () => {
    expect(() => svc.getDay({ userId: 'kckern', corpusId: 'nope' })).toThrow(EntityNotFoundError);
  });
});

describe('logAttempt', () => {
  let ds; let svc;
  beforeEach(() => { ds = new FakeDatastore(); svc = makeService(ds); });

  it('records a repetition with attribution and no response fields', () => {
    const event = svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    expect(event).toMatchObject({ seq: 1, rung: 'repetition', day: 1, attributedTo: 'kckern' });
    expect(event.given).toBeUndefined();
    expect(event.accuracy).toBeUndefined();
  });

  it('scores a dictation against the TARGET language', () => {
    makeDue(ds, 'dictation');
    const event = svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'dictation',
      given: '오늘 날씨가 좋아요.',
      capabilities: EQUIPPED,
    });
    expect(event.language).toBe('KR');
    expect(event.expected).toBe('오늘 날씨가 좋아요.');
    expect(event.accuracy).toBe(1);
  });

  it('scores an interpretation against the SOURCE language', () => {
    makeDue(ds, 'interpretation');
    const event = svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'interpretation',
      given: "The weather's nice today.",
      capabilities: EQUIPPED,
    });
    expect(event.language).toBe('EN');
    expect(event.accuracy).toBe(1);
  });

  it('records a wrong answer WITHOUT blocking graduation', () => {
    makeDue(ds, 'dictation');
    // Accuracy is informational. A wrong dictation still clears the rung.
    svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'dictation', given: '전혀 다른 문장', capabilities: EQUIPPED,
    });
    const events = ds.readAllEvents('kckern', 'test-korean');
    const event = events.at(-1);
    expect(event.accuracy).toBeLessThan(0.5);
    expect(event.rung).toBe('dictation');
  });

  it('rejects a text rung with no response', () => {
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'dictation', given: '   ',
    })).toThrow(ValidationError);
  });

  it('rejects an unknown rung and an unknown sentence', () => {
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'nonsense',
    })).toThrow(ValidationError);
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 999, rung: 'repetition',
    })).toThrow(EntityNotFoundError);
  });

  it('stamps last activity so rollover has something to measure from', () => {
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    expect(ds.readProgress('kckern', 'test-korean').last_activity)
      .toBe(new Date(AT).toISOString());
  });

  it('rejects out-of-queue, duplicate, and generic recording evidence', () => {
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 1 });
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 2, rung: 'repetition', capabilities: EQUIPPED,
    })).toThrow(/outstanding/);
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition', capabilities: EQUIPPED });
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition', capabilities: EQUIPPED,
    })).toThrow(/outstanding/);
    expect(() => svc.logAttempt({
      userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'recording', capabilities: EQUIPPED,
    })).toThrow(/audio upload/);
  });
});

describe('saveRecording', () => {
  it('writes the file BEFORE logging, so a crash orphans a file not an event', () => {
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    makeDue(ds, 'recording', 2);
    svc.saveRecording({
      userId: 'kckern', corpusId: 'test-korean', seq: 2, buffer: Buffer.from('audio'), capabilities: EQUIPPED,
    });
    expect(ds.written).toHaveLength(1);
    expect(ds.readAllEvents('kckern', 'test-korean').at(-1).rung).toBe('recording');
  });

  it('rejects an empty recording', () => {
    const svc = makeService(new FakeDatastore());
    expect(() => svc.saveRecording({
      userId: 'kckern', corpusId: 'test-korean', seq: 2, buffer: Buffer.alloc(0),
    })).toThrow(ValidationError);
  });

  it('does not write audio for a recording that is not currently due', () => {
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    expect(() => svc.saveRecording({
      userId: 'kckern', corpusId: 'test-korean', seq: 1,
      buffer: Buffer.from('audio'), capabilities: EQUIPPED,
    })).toThrow(/outstanding/);
    expect(ds.written).toEqual([]);
  });
});

describe('School lifecycle completion emission', () => {
  it('accepts all four due modes and emits canonical completion after the final step', () => {
    const ds = new FakeDatastore();
    const eventBus = { publish: vi.fn() };
    const enrollment = {
      programId: 'sentence-ladder', corpusId: 'test-korean', lessonSize: 4,
      rungs: ['repetition', 'dictation', 'recording', 'interpretation'],
    };
    const svc = makeService(ds, AT, {
      readProgramEnrollment: () => enrollment,
      eventBus,
    });

    ds.writeProgress('kckern', 'test-korean', {
      corpus: 'test-korean', day: 4, daily_limit: 1, last_activity: null,
    });
    for (const event of [
      { day: 3, seq: 1, rung: 'repetition' },
      { day: 2, seq: 2, rung: 'repetition' },
      { day: 3, seq: 2, rung: 'dictation', given: 'x', expected: 'x', accuracy: 1 },
      { day: 1, seq: 3, rung: 'repetition' },
      { day: 2, seq: 3, rung: 'dictation', given: 'x', expected: 'x', accuracy: 1 },
      { day: 3, seq: 3, rung: 'recording' },
    ]) {
      ds.appendEvent('kckern', 'test-korean', {
        ...event, at: new Date(AT - (4 - event.day) * 86_400_000).toISOString(), attributedTo: 'kckern',
      });
    }

    const initial = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(initial.queue.filter((entry) => !entry.done).map(({ seq, rung }) => ({ seq, rung }))).toEqual([
      { seq: 4, rung: 'repetition' },
      { seq: 1, rung: 'dictation' },
      { seq: 2, rung: 'recording' },
      { seq: 3, rung: 'interpretation' },
    ]);

    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 4, rung: 'repetition', capabilities: EQUIPPED });
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'dictation', given: '오늘 날씨가 좋아요.', capabilities: EQUIPPED });
    svc.saveRecording({ userId: 'kckern', corpusId: 'test-korean', seq: 2, buffer: Buffer.from('audio'), capabilities: EQUIPPED });
    expect(eventBus.publish).not.toHaveBeenCalled();
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 3, rung: 'interpretation', given: "This bag's heavy.", capabilities: EQUIPPED });

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith('school.language.day-complete', {
      learnerId: 'kckern', corpusId: 'test-korean', day: 4, programId: 'sentence-ladder',
    });
    expect(svc.todayStatus({ userId: 'kckern', corpusId: 'test-korean' })).toMatchObject({
      doneToday: true, progressLabel: 'Day 4', score: null,
    });
  });
});

describe('pacing', () => {
  it('clamps to a sane range instead of trusting the client', () => {
    const svc = makeService(new FakeDatastore());
    expect(svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 9999 }).dailyLimit).toBe(100);
    expect(svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 0 }).dailyLimit).toBe(1);
    expect(svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 'abc' }).dailyLimit).toBe(5);
  });

  it('preserves the day when pacing changes', () => {
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    ds.writeProgress('kckern', 'test-korean', { corpus: 'test-korean', day: 7, daily_limit: 5, last_activity: null });
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 10 });
    expect(ds.readProgress('kckern', 'test-korean').day).toBe(7);
  });
});

describe('rollDay', () => {
  it('refuses while work is outstanding', () => {
    const svc = makeService(new FakeDatastore());
    const result = svc.rollDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(result).toEqual({ rolled: false, day: 1, reason: 'queue-incomplete' });
  });

  it('refuses before the boundary even with the queue finished', () => {
    // A client asking early must not be able to rush the spacing.
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 3 });
    for (const seq of [1, 2, 3]) {
      svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq, rung: 'repetition' });
    }
    const result = svc.rollDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(result.rolled).toBe(false);
    expect(result.reason).toBe('before-boundary');
  });

  it('rolls once the boundary has passed', () => {
    const ds = new FakeDatastore();
    let clock = AT;
    const svc = makeService(ds, () => clock);
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 3 });
    for (const seq of [1, 2, 3]) {
      svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq, rung: 'repetition' });
    }
    clock = Date.parse('2026-07-22T10:00:00Z');
    const result = svc.rollDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(result).toEqual({ rolled: true, day: 2, reason: 'earned' });
  });

  it('promotes yesterday\'s sentences after the roll', () => {
    const ds = new FakeDatastore();
    let clock = AT;
    const svc = makeService(ds, () => clock);
    svc.setPacing({ userId: 'kckern', corpusId: 'test-korean', dailyLimit: 1 });
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    clock = Date.parse('2026-07-22T10:00:00Z');
    svc.rollDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });

    const day = svc.getDay({ userId: 'kckern', corpusId: 'test-korean', capabilities: EQUIPPED });
    expect(day.day).toBe(2);
    expect(day.queue.find((e) => e.seq === 1).rung).toBe('dictation');
  });
});

describe('history', () => {
  it('folds the log by study day, newest first, with text attached', () => {
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    ds.writeProgress('kckern', 'test-korean', { corpus: 'test-korean', day: 2, daily_limit: 5, last_activity: null });
    svc.logAttempt({ userId: 'kckern', corpusId: 'test-korean', seq: 2, rung: 'repetition' });

    const history = svc.getHistory({ userId: 'kckern', corpusId: 'test-korean' });
    expect(history.days.map((d) => d.day)).toEqual([2, 1]);
    expect(history.days[1].items[0].text).toEqual(CORPUS.sentences[0].text);
  });

  it('only offers playback when the recording file actually exists', () => {
    const ds = new FakeDatastore();
    const svc = makeService(ds);
    makeDue(ds, 'recording', 1);
    svc.saveRecording({ userId: 'kckern', corpusId: 'test-korean', seq: 1, buffer: Buffer.from('a'), capabilities: EQUIPPED });
    // An event whose file has since vanished stands as evidence but offers no audio.
    ds.appendEvent('kckern', 'test-korean', {
      at: new Date(AT).toISOString(), day: 3, seq: 3, rung: 'recording', attributedTo: 'kckern',
    });

    const items = svc.getHistory({ userId: 'kckern', corpusId: 'test-korean' }).days[0].items;
    expect(items.find((i) => i.seq === 1).hasAudio).toBe(true);
    expect(items.find((i) => i.seq === 3).hasAudio).toBe(false);
  });
});
