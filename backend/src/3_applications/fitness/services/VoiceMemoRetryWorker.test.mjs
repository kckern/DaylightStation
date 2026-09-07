import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VoiceMemoRetryWorker } from './VoiceMemoRetryWorker.mjs';
import { FitnessVoiceMemoService } from './FitnessVoiceMemoService.mjs';
import { FilesystemVoiceMemoArtifactStore } from '#adapters/fitness/FilesystemVoiceMemoArtifactStore.mjs';
import {
  ARTIFACT_STATES, ATTEMPT_LEASE_MS, RAW_AUDIO_RETENTION_MS, RECORD_RETENTION_MS,
} from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

const AUDIO = Buffer.from('spoken words, encoded');
const silent = { info() {}, warn() {}, error() {}, debug() {} };

let dataDir, store, now;

const artifactDir = () => path.join(dataDir, 'household', 'fitness/voice-memos');
const clock = { now: () => now };

function makeConfigService(dir) {
  return {
    getDataDir: () => dir,
    getDefaultHouseholdId: () => 'default',
    getHouseholdPath: (relative) => path.join(dir, 'household', relative),
  };
}

function makeWorker({ transcribeVoiceMemo = vi.fn(async () => ({ transcriptRaw: 'x', transcriptClean: 'X' })),
  sessions = { getSession: async () => ({ endTime: 1 }), appendVoiceMemo: async (i, h, m) => m } } = {}) {
  const memos = new FitnessVoiceMemoService({
    transcription: { transcribeVoiceMemo }, sessions, artifacts: store, clock, logger: silent,
  });
  return {
    memos,
    transcribeVoiceMemo,
    worker: new VoiceMemoRetryWorker({ artifacts: store, memos, clock, logger: silent }),
  };
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-vm-worker-'));
  now = 1_700_000_000_000;
  store = new FilesystemVoiceMemoArtifactStore({ configService: makeConfigService(dataDir), logger: silent, clock: () => now });
});

describe('crash recovery', () => {
  it('reclaims an attempt that died mid-flight and finishes it', async () => {
    const { worker, transcribeVoiceMemo } = makeWorker();
    const record = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    // Exactly what a redeploy leaves behind: leased, never released.
    store.claim(null, record.ref, now);

    now += ATTEMPT_LEASE_MS + 1;
    const stats = await worker.tick();

    expect(stats.reclaimed).toBe(1);
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.TRANSCRIBED);
  });

  it('leaves an attempt that is still inside its lease window alone', async () => {
    const { worker, transcribeVoiceMemo } = makeWorker();
    const record = await store.create({ buffer: AUDIO });
    store.claim(null, record.ref, now);

    now += 1000;
    const stats = await worker.tick();

    expect(stats.reclaimed).toBe(0);
    expect(transcribeVoiceMemo).not.toHaveBeenCalled();
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.PROCESSING);
  });

  it('picks up a pending capture whose backend died before the first attempt', async () => {
    const { worker } = makeWorker();
    const record = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });

    await worker.tick();
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.TRANSCRIBED);
  });

  it('does not transcribe the same artifact twice when ticks overlap', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const transcribeVoiceMemo = vi.fn(async () => {
      await gate;
      return { transcriptRaw: 'x', transcriptClean: 'X' };
    });
    const { worker } = makeWorker({ transcribeVoiceMemo });
    await store.create({ buffer: AUDIO, sessionId: '20260907120000' });

    const first = worker.tick();
    // A second tick arrives while the first is still inside the provider call.
    await worker.tick();
    release();
    await first;

    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);
  });
});

describe('retention', () => {
  it('expires a capture that was never transcribed, and destroys its audio', async () => {
    const { worker } = makeWorker({
      transcribeVoiceMemo: vi.fn(async () => { throw Object.assign(new Error('down'), { status: 503 }); }),
    });
    const record = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    await worker.tick();
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.RETRYABLE);

    now += RAW_AUDIO_RETENTION_MS + 1;
    const stats = await worker.tick();

    expect(stats.expired).toBe(1);
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.EXPIRED);
    // The record remains so staff can see the memo existed and why it has none.
    expect(store.readAudio(null, record.ref)).toBeNull();
    expect(store.get(null, record.ref).lastFailure.classification).toBe('provider_unavailable');
  });

  it('keeps a permanently failed recording for the window, then destroys it', async () => {
    const { worker } = makeWorker({
      transcribeVoiceMemo: vi.fn(async () => { throw Object.assign(new Error('bad key'), { status: 401 }); }),
    });
    const record = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    await worker.tick();
    expect(store.get(null, record.ref).state).toBe(ARTIFACT_STATES.PERMANENTLY_FAILED);
    expect(store.readAudio(null, record.ref)).not.toBeNull();

    now += RAW_AUDIO_RETENTION_MS + 1;
    await worker.tick();
    expect(store.readAudio(null, record.ref)).toBeNull();
  });

  it('drops the audio-free record once it has aged out', async () => {
    const { worker } = makeWorker();
    const record = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    await worker.tick();

    now += RECORD_RETENTION_MS + 1;
    const stats = await worker.tick();

    expect(stats.deleted).toBe(1);
    expect(store.get(null, record.ref)).toBeNull();
    expect(fs.readdirSync(artifactDir())).toEqual([]);
  });

  it('removes audio a crash left with no record — nobody can ever claim it', async () => {
    const { worker } = makeWorker();
    const record = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    fs.unlinkSync(path.join(artifactDir(), `${record.ref}.json`));

    const stats = await worker.tick();

    expect(stats.orphansRemoved).toBe(1);
    expect(fs.readdirSync(artifactDir())).toEqual([]);
  });
});

describe('scheduling', () => {
  it('waits out the backoff instead of hammering a provider that just failed', async () => {
    const transcribeVoiceMemo = vi.fn(async () => { throw Object.assign(new Error('slow down'), { status: 429 }); });
    const { worker } = makeWorker({ transcribeVoiceMemo });
    await store.create({ buffer: AUDIO, sessionId: '20260907120000' });

    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);

    now += 1000;
    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);

    now += 60_000;
    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(2);
  });

  it('drains a backlog in bounded batches rather than in one burst', async () => {
    const transcribeVoiceMemo = vi.fn(async () => ({ transcriptRaw: 'x', transcriptClean: 'X' }));
    const { worker } = makeWorker({ transcribeVoiceMemo });
    for (let i = 0; i < 8; i += 1) await store.create({ buffer: AUDIO, sessionId: '20260907120000' });

    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(5);
    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(8);
  });

  it('stops touching an artifact once it is settled', async () => {
    const { worker, transcribeVoiceMemo } = makeWorker();
    await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    await worker.tick();

    now += 60_000;
    await worker.tick();
    expect(transcribeVoiceMemo).toHaveBeenCalledTimes(1);
  });
});
