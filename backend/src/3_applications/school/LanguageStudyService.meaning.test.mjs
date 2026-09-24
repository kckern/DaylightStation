/**
 * The meaning score rides on the interpretation row and changes nothing else:
 * the synchronous `logAttempt` never calls the judge, a missing or failing
 * judge writes exactly the old row, and only a STORED attempt is logged.
 */
import { describe, it, expect, vi } from 'vitest';
import { LanguageStudyService } from './LanguageStudyService.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/test-korean',
  sentences: [
    { seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } },
    { seq: 2, text: { EN: "I'm not rich.", KR: '저는 부자가 아니예요.' } },
  ],
};
const EQUIPPED = { microphone: true, textInput: ['EN', 'KR'] };
const AT = Date.parse('2026-07-21T10:00:00Z');

class FakeDatastore {
  constructor() { this.events = []; this.progress = null; }
  listCorpusIds() { return [CORPUS.id]; }
  readCorpus(id) { return id === CORPUS.id ? CORPUS : null; }
  readProgress() { return this.progress; }
  writeProgress(_u, _c, p) { this.progress = p; return p; }
  appendEvent(_u, _c, e) { this.events.push(e); return e; }
  readAllEvents() { return this.events; }
  listRecordingKeys() { return new Set(); }
  resolveAudioPath(c, seq, lang) { return `/media/${c}/${seq}-${lang}.mp3`; }
}

/** Seed seq 1 up to the given rung, as the main suite's makeDue does. */
function makeDue(ds, rung) {
  const chain = ['repetition', 'dictation', 'recording', 'interpretation'];
  const index = chain.indexOf(rung);
  for (let i = 0; i < index; i += 1) {
    ds.appendEvent('kckern', CORPUS.id, {
      at: new Date(AT - (index - i) * 86_400_000).toISOString(),
      day: i + 1, seq: 1, rung: chain[i], attributedTo: 'kckern',
    });
  }
  ds.writeProgress('kckern', CORPUS.id, { corpus: CORPUS.id, day: index + 1, daily_limit: 5, last_activity: null });
}

const MODEL_MEANING = { score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0', ms: 212 };

function setup({ judge = vi.fn(async () => MODEL_MEANING), rung = 'interpretation' } = {}) {
  const ds = new FakeDatastore();
  makeDue(ds, rung);
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const meaningJudge = judge ? { judge } : null;
  const svc = new LanguageStudyService({ datastore: ds, now: () => AT, timezone: 'UTC', logger, meaningJudge });
  return { ds, svc, logger, judge };
}
const ARGS = { userId: 'kckern', corpusId: CORPUS.id, seq: 1, capabilities: EQUIPPED };

describe('submitAttempt — meaning on the interpretation row', () => {
  it('asks the judge with the source-language reference and stores meaning beside accuracy', async () => {
    const { svc, judge, ds } = setup();
    const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: ' today the weather is nice ', method: 'typed' });
    expect(judge).toHaveBeenCalledWith({
      given: 'today the weather is nice', expected: "The weather's nice today.", language: 'EN', accuracy: 0.4,
    });
    expect(event.accuracy).toBe(0.4);
    expect(event.meaning).toEqual({ score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0' });
    expect(ds.events.at(-1)).toBe(event);
  });

  it('logs school.language.meaning only after the row is stored', async () => {
    const { svc, logger } = setup();
    await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice', method: 'spoken', runId: 'run-1' });
    expect(logger.info).toHaveBeenCalledWith('school.language.meaning', {
      learnerId: 'kckern', corpus: CORPUS.id, seq: 1, accuracy: 0.4, meaning: 0.8, level: 3,
      confidence: 0.81, judge: 'model', model: 'jev-1.13.0', method: 'spoken', practice: false, ms: 212,
    }, { context: { runId: 'run-1' } });
  });

  it('writes the old row when the judge returns null or throws', async () => {
    for (const judge of [vi.fn(async () => null), vi.fn(async () => { throw new Error('boom'); })]) {
      const { svc, logger } = setup({ judge });
      const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
      expect(event).not.toHaveProperty('meaning');
      expect(event.accuracy).toBe(0.4);
      expect(logger.info).not.toHaveBeenCalledWith('school.language.meaning', expect.anything(), expect.anything());
    }
  });

  it('without a judge, submitAttempt is logAttempt', async () => {
    const { svc } = setup({ judge: null });
    const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    expect(event).not.toHaveProperty('meaning');
    expect(event.accuracy).toBe(0.4);
  });

  it('never judges dictation, a reveal, or a blank answer', async () => {
    const dictation = setup({ rung: 'dictation' });
    const row = await dictation.svc.submitAttempt({ ...ARGS, rung: 'dictation', given: '오늘 날씨가 좋아요' });
    expect(row).not.toHaveProperty('meaning');
    expect(dictation.judge).not.toHaveBeenCalled();

    const reveal = setup();
    const shown = await reveal.svc.submitAttempt({ ...ARGS, rung: 'interpretation', revealed: true });
    expect(shown).not.toHaveProperty('meaning');
    expect(reveal.judge).not.toHaveBeenCalled();

    const blank = setup();
    await expect(blank.svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(blank.judge).not.toHaveBeenCalled();
  });

  it('a refused attempt (not due) records and logs no meaning', async () => {
    const { svc, logger, ds } = setup({ rung: 'dictation' });
    const before = ds.events.length;
    await expect(svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(ds.events.length).toBe(before);
    expect(logger.info).not.toHaveBeenCalledWith('school.language.meaning', expect.anything(), expect.anything());
  });

  it('the synchronous logAttempt never calls the judge', () => {
    const { svc, judge } = setup();
    const event = svc.logAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    expect(judge).not.toHaveBeenCalled();
    expect(event).not.toHaveProperty('meaning');
  });
});

describe('summarize — meaning metric', () => {
  it('averages meaning for the grown-up, and is absent until a row has one', async () => {
    const { svc, ds } = setup({ judge: null });
    await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    let [course] = svc.summarize({ userId: 'kckern' });
    expect(course.metrics.find((m) => m.id === 'meaning')).toBeUndefined();

    ds.events.push(
      { at: new Date(AT).toISOString(), day: 4, seq: 2, rung: 'interpretation', given: 'x', accuracy: 0.2, meaning: { score: 0.5, level: 2, confidence: 0.7, judge: 'model', model: 'm' } },
      { at: new Date(AT).toISOString(), day: 4, seq: 2, rung: 'interpretation', given: 'y', accuracy: 1, meaning: { score: 1, level: 4, confidence: 1, judge: 'exact' } },
    );
    [course] = svc.summarize({ userId: 'kckern' });
    const metric = course.metrics.find((m) => m.id === 'meaning');
    expect(metric).toEqual({ id: 'meaning', kind: 'score', label: 'Meaning understood', value: 0.75 });
    expect(metric).not.toHaveProperty('audience');
  });
});
