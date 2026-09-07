import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FitnessVoiceMemoService } from './FitnessVoiceMemoService.mjs';
import { VoiceMemoRetryWorker } from './VoiceMemoRetryWorker.mjs';
import { FilesystemVoiceMemoArtifactStore } from '#adapters/fitness/FilesystemVoiceMemoArtifactStore.mjs';
import { ARTIFACT_STATES } from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

/**
 * The 2026-09-07 incident, reproduced and then survived: a voice memo hits a
 * provider that is out of credit, and the recording must still be there when
 * the credit comes back.
 */

const AUDIO = Buffer.from('spoken words, encoded');
const SESSION_ID = '20260907120000';

let dataDir, store, logs;

function makeConfigService(dir) {
  return {
    getDataDir: () => dir,
    getDefaultHouseholdId: () => 'default',
    getHouseholdPath: (relative) => path.join(dir, 'household', relative),
  };
}

/** A logger that keeps every event so the tests can assert on what leaked. */
function recordingLogger(sink) {
  const push = (level) => (event, data) => sink.push({ level, event, data });
  return { info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug') };
}

function quotaError() {
  const error = new Error('You exceeded your current quota, please check your plan and billing details');
  error.status = 429;
  error.apiError = { code: 'insufficient_quota', type: 'insufficient_quota' };
  return error;
}

function authError() {
  // Deliberately NOT key-shaped: this fixture only has to be a distinctive
  // string that must not survive into a log, and a realistic-looking secret in
  // a committed test is a false positive waiting to happen.
  const error = new Error('Incorrect API key provided: REDACTED-KEY-FIXTURE');
  error.status = 401;
  error.apiError = { code: 'invalid_api_key', type: 'invalid_request_error' };
  return error;
}

/** An ended session, which is what makes the backend responsible for the write. */
function endedSessions({ appendVoiceMemo } = {}) {
  return {
    getSession: vi.fn(async () => ({ endTime: 1 })),
    appendVoiceMemo: appendVoiceMemo || vi.fn(async (sessionId, hid, memo) => memo),
  };
}

function makeService({ transcribeVoiceMemo, sessions = null, clock }) {
  return new FitnessVoiceMemoService({
    transcription: { transcribeVoiceMemo },
    sessions,
    artifacts: store,
    clock: clock || { now: () => Date.now() },
    logger: recordingLogger(logs),
  });
}

const artifactDir = () => path.join(dataDir, 'household', 'fitness/voice-memos');

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-vm-svc-'));
  logs = [];
  store = new FilesystemVoiceMemoArtifactStore({
    configService: makeConfigService(dataDir),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
});

describe('a provider outage no longer ends the recording', () => {
  it('keeps the audio and schedules a retry when the provider is out of credit', async () => {
    const service = makeService({ transcribeVoiceMemo: vi.fn(async () => { throw quotaError(); }) });

    const result = await service.transcribe({ audioBuffer: AUDIO, mimeType: 'audio/webm', sessionId: SESSION_ID });

    expect(result.kind).toBe('transcription_failed');
    expect(result.artifact.state).toBe(ARTIFACT_STATES.RETRYABLE);
    expect(result.artifact.lastFailure.classification).toBe('quota_exhausted');
    expect(result.artifact.audioAvailable).toBe(true);
    // The bytes: the whole point.
    expect(store.readAudio(null, result.artifact.ref).buffer).toEqual(AUDIO);
  });

  it('retranscribes that same recording once the provider recovers', async () => {
    let credit = false;
    const transcribeVoiceMemo = vi.fn(async ({ audioBuffer }) => {
      if (!credit) throw quotaError();
      return { transcriptRaw: 'transcript fixture one', transcriptClean: 'Transcript fixture one', durationSeconds: 4 };
    });
    const sessions = endedSessions();
    const service = makeService({ transcribeVoiceMemo, sessions });

    const failed = await service.transcribe({ audioBuffer: AUDIO, mimeType: 'audio/webm', sessionId: SESSION_ID });
    const { ref } = failed.artifact;

    credit = true;
    const worker = new VoiceMemoRetryWorker({
      artifacts: store, memos: service,
      // The record's backoff sits 30 minutes out; the worker must see it as due
      // once that time has actually passed.
      clock: { now: () => Date.now() + 31 * 60_000 },
      logger: recordingLogger(logs),
    });
    const stats = await worker.tick();

    expect(stats.transcribed).toBe(1);
    // The provider saw the very bytes that were captured, not a re-recording.
    expect(transcribeVoiceMemo.mock.calls.at(-1)[0].audioBuffer).toEqual(AUDIO);
    // 'default' is the household the sweep resolved; the capture stored null,
    // which is the same household by another name.
    expect(sessions.appendVoiceMemo).toHaveBeenCalledWith(SESSION_ID, 'default',
      expect.objectContaining({ transcriptClean: 'Transcript fixture one', memoId: ref }));

    const record = store.get(null, ref);
    expect(record.state).toBe(ARTIFACT_STATES.TRANSCRIBED);
    // Retention: a transcript makes the recording redundant immediately.
    expect(store.readAudio(null, ref)).toBeNull();
    expect(record.audioPurgedAt).not.toBeNull();
  });

  it('does not schedule an automatic retry for a rejected API key', async () => {
    const service = makeService({ transcribeVoiceMemo: vi.fn(async () => { throw authError(); }) });
    const result = await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });

    expect(result.artifact.state).toBe(ARTIFACT_STATES.PERMANENTLY_FAILED);
    expect(result.artifact.lastFailure.classification).toBe('auth_failed');
    // But the recording stays, because a human fixing the key is a real recovery.
    expect(result.artifact.audioAvailable).toBe(true);
  });

  it('runs a staff-triggered retry immediately, whatever the backoff said', async () => {
    let broken = true;
    const service = makeService({
      transcribeVoiceMemo: vi.fn(async () => {
        if (broken) throw authError();
        return { transcriptRaw: 'ok', transcriptClean: 'Ok' };
      }),
      sessions: endedSessions(),
    });
    const failed = await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });

    broken = false;
    const retried = await service.retryArtifact(null, failed.artifact.ref);

    expect(retried.kind).toBe('transcribed');
    expect(retried.memo.transcriptClean).toBe('Ok');
    expect(store.get(null, failed.artifact.ref).state).toBe(ARTIFACT_STATES.TRANSCRIBED);
  });

  it('reports a purged artifact as missing audio rather than blaming the provider', async () => {
    const service = makeService({ transcribeVoiceMemo: vi.fn(async () => { throw quotaError(); }) });
    const failed = await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });
    store.purgeAudio(null, failed.artifact.ref);

    const retried = await service.retryArtifact(null, failed.artifact.ref);
    expect(retried.artifact.givenUpReason).toBe('audio_missing');
  });
});

describe('the happy path still behaves, and closes out the artifact', () => {
  it('hands the memo back and leaves no recording behind', async () => {
    const service = makeService({
      transcribeVoiceMemo: vi.fn(async () => ({ transcriptRaw: 'raw', transcriptClean: 'Clean', durationSeconds: 3 })),
      sessions: endedSessions(),
    });

    const result = await service.transcribe({ audioBuffer: AUDIO, mimeType: 'audio/webm', sessionId: SESSION_ID });

    expect(result.kind).toBe('transcribed');
    expect(result.memo.transcriptClean).toBe('Clean');
    // memoId IS the artifact ref, so the memo, its recording, and its retry
    // history all answer to one id.
    expect(result.memo.memoId).toBe(result.artifact.ref);
    expect(fs.readdirSync(artifactDir()).filter((f) => !f.endsWith('.json'))).toEqual([]);
  });

  it('leaves a live session to the browser, and defers nothing to a retry', async () => {
    const sessions = {
      getSession: vi.fn(async () => ({ endTime: Date.now() + 60_000 })),
      appendVoiceMemo: vi.fn(),
    };
    const service = makeService({
      transcribeVoiceMemo: vi.fn(async () => ({ transcriptRaw: 'x', transcriptClean: 'X' })),
      sessions,
    });
    const result = await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });

    expect(sessions.appendVoiceMemo).not.toHaveBeenCalled();
    expect(store.get(null, result.artifact.ref).state).toBe(ARTIFACT_STATES.TRANSCRIBED);
  });

  it('holds a recovered memo open until its session ends, without paying for a second transcript', async () => {
    const transcribeVoiceMemo = vi.fn(async () => ({ transcriptRaw: 'x', transcriptClean: 'X' }));
    let sessionEnd = Date.now() + 60_000;
    const sessions = {
      getSession: vi.fn(async () => ({ endTime: sessionEnd })),
      appendVoiceMemo: vi.fn(async (id, hid, memo) => memo),
    };
    // A retry, not the interactive path: no browser is listening, so the
    // backend owns the write and must wait for the session to be writable.
    const service = makeService({ transcribeVoiceMemo, sessions });
    const record = await store.create({ buffer: AUDIO, sessionId: SESSION_ID });

    const deferred = await service.runAttempt(null, record.ref, { trigger: 'retry' });
    expect(deferred.kind).toBe('transcribed');
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.RETRYABLE);
    expect(sessions.appendVoiceMemo).not.toHaveBeenCalled();

    sessionEnd = Date.now() - 1;
    await service.runAttempt(null, record.ref, { trigger: 'retry' });

    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);
    expect(sessions.appendVoiceMemo).toHaveBeenCalledTimes(1);
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.TRANSCRIBED);
  });
});

describe('what reaches the log store', () => {
  it('logs the failure classification and the request id, never the provider prose or the key', async () => {
    const service = makeService({ transcribeVoiceMemo: vi.fn(async () => { throw authError(); }) });
    await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });

    const serialized = JSON.stringify(logs);
    expect(serialized).toMatch(/auth_failed/);
    expect(serialized).not.toMatch(/REDACTED-KEY-FIXTURE/);
    expect(serialized).not.toMatch(/Incorrect API key/);
  });

  it('never logs the transcript or the audio', async () => {
    const service = makeService({
      transcribeVoiceMemo: vi.fn(async () => ({
        // Stands in for what a memo actually contains — somebody's health,
        // mood, or plans. The assertion below is that none of it is logged.
        transcriptRaw: 'transcript fixture that must never be logged',
        transcriptClean: 'Transcript fixture that must never be logged',
      })),
      sessions: endedSessions(),
    });
    await service.transcribe({ audioBuffer: AUDIO, mimeType: 'audio/webm', sessionId: SESSION_ID });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toMatch(/must never be logged/);
    expect(serialized).not.toMatch(/spoken words/);
    // The length is fine — it is what tells you a transcript happened at all.
    expect(serialized).toMatch(/transcriptLength/);
  });
});

describe('the staff view', () => {
  it('reports state and diagnostics without exposing audio or transcript', async () => {
    const service = makeService({
      transcribeVoiceMemo: vi.fn(async () => ({ transcriptRaw: 'transcript fixture two', transcriptClean: 'Transcript fixture two' })),
      sessions: endedSessions(),
    });
    await service.transcribe({ audioBuffer: AUDIO, sessionId: SESSION_ID });

    const [artifact] = service.listArtifacts({ sessionId: SESSION_ID });
    expect(artifact.state).toBe(ARTIFACT_STATES.TRANSCRIBED);
    expect(artifact.hasTranscript).toBe(true);
    expect(artifact.audioAvailable).toBe(false);
    expect(JSON.stringify(artifact)).not.toMatch(/transcript fixture two/i);
  });

  it('reports an unknown ref as not found rather than as a failure', async () => {
    const service = makeService({ transcribeVoiceMemo: vi.fn() });
    expect(await service.retryArtifact(null, 'vm_' + 'z'.repeat(16))).toEqual({ kind: 'not_found' });
    expect(await service.retryArtifact(null, '../../etc/passwd')).toEqual({ kind: 'not_found' });
  });
});

describe('without an artifact store wired', () => {
  it('still transcribes, and does not pretend the capture was saved', async () => {
    const service = new FitnessVoiceMemoService({
      transcription: { transcribeVoiceMemo: vi.fn(async () => ({ transcriptRaw: 'x', transcriptClean: 'X' })) },
      logger: recordingLogger(logs),
    });
    expect(service.durable).toBe(false);
    const result = await service.transcribe({ audioBuffer: AUDIO });
    expect(result.kind).toBe('transcribed');
    expect(result.artifact).toBeUndefined();
  });
});
