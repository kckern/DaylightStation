/**
 * Regression: an attempt the datastore REFUSED to write must not be reported
 * as saved.
 *
 * Caught during live verification — three attempts returned 200 with a full
 * event body while nothing reached disk, because the datastore returns null
 * (rather than throwing) for an unresolvable user path and the service ignored
 * the return value. The learner's history was simply empty afterwards, with no
 * error anywhere. Exactly what School's "failures are never silent" rule is for.
 */
import { describe, it, expect } from 'vitest';
import { LanguageStudyService } from './LanguageStudyService.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  sentences: [{ seq: 1, text: { EN: 'Hello.', KR: '안녕하세요.' } }],
};

/** Refuses every write the way the YAML datastore does: by returning null. */
class RefusingDatastore {
  constructor() { this.progressWrites = 0; }
  listCorpusIds() { return ['test-korean']; }
  readCorpus() { return CORPUS; }
  readProgress() { return null; }
  writeProgress() { this.progressWrites += 1; return null; }
  appendEvent() { return null; }        // <- the refusal
  readAllEvents() { return []; }
  writeRecording() { return '/tmp/x.webm'; }
  listRecordingKeys() { return new Set(); }
  resolveAudioPath() { return null; }
  resolveRecordingPath() { return null; }
}

function makeService(ds) {
  return new LanguageStudyService({
    datastore: ds,
    now: () => Date.parse('2026-07-21T10:00:00Z'),
    timezone: 'UTC',
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  });
}

describe('a refused write', () => {
  it('throws instead of returning a plausible event', () => {
    const svc = makeService(new RefusingDatastore());
    expect(() => svc.logAttempt({
      userId: 'ghost', corpusId: 'test-korean', seq: 1, rung: 'repetition',
    })).toThrow(EntityNotFoundError);
  });

  it('does not stamp last-activity for an attempt that was never stored', () => {
    // Otherwise the learner's pacing advances on evidence that does not exist,
    // and rollover starts measuring from a phantom session.
    const ds = new RefusingDatastore();
    const svc = makeService(ds);
    try {
      svc.logAttempt({ userId: 'ghost', corpusId: 'test-korean', seq: 1, rung: 'repetition' });
    } catch { /* expected */ }
    expect(ds.progressWrites).toBe(0);
  });

  it('propagates through saveRecording too, so a stored file cannot fake a done rung', () => {
    const svc = makeService(new RefusingDatastore());
    expect(() => svc.saveRecording({
      userId: 'ghost', corpusId: 'test-korean', seq: 1, buffer: Buffer.from('a'),
    })).toThrow(EntityNotFoundError);
  });
});
