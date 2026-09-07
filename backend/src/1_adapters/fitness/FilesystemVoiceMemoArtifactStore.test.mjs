import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  FilesystemVoiceMemoArtifactStore, ARTIFACT_REF_PATTERN, isValidArtifactRef, extensionForMime,
} from './FilesystemVoiceMemoArtifactStore.mjs';
import { ARTIFACT_STATES } from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const AUDIO = Buffer.from('not really opus, but bytes are bytes');

let dataDir, store;

function makeConfigService(dir) {
  return {
    getDataDir: () => dir,
    getDefaultHouseholdId: () => 'default',
    getHouseholdPath: (relative, householdId) => path.join(
      dir,
      householdId && householdId !== 'default' ? `household-${householdId}` : 'household',
      relative,
    ),
  };
}

const artifactDir = (hid = null) => path.join(
  dataDir, hid ? `household-${hid}` : 'household', 'fitness/voice-memos',
);

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-vm-'));
  store = new FilesystemVoiceMemoArtifactStore({ configService: makeConfigService(dataDir), logger: silent });
});

describe('FilesystemVoiceMemoArtifactStore.create', () => {
  it('writes the bytes and opens a pending record beside them', async () => {
    const record = await store.create({ buffer: AUDIO, mimeType: 'audio/webm;codecs=opus', sessionId: '20260907120000' });

    expect(ARTIFACT_REF_PATTERN.test(record.ref)).toBe(true);
    expect(record.state).toBe(ARTIFACT_STATES.PENDING);
    expect(record.bytes).toBe(AUDIO.length);
    // The codec parameter is dropped; the container survives, because a retry
    // has to tell the provider what it is sending.
    expect(fs.readFileSync(path.join(artifactDir(), `${record.ref}.webm`))).toEqual(AUDIO);
    expect(fs.existsSync(path.join(artifactDir(), `${record.ref}.json`))).toBe(true);
  });

  it('checksums the capture so a truncated retry is detectable', async () => {
    const record = await store.create({ buffer: AUDIO });
    expect(record.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('writes the audio readable only by its owner', async () => {
    const record = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    const mode = fs.statSync(path.join(artifactDir(), `${record.ref}.webm`)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('refuses an empty capture and one past the size ceiling', async () => {
    await expect(store.create({ buffer: Buffer.alloc(0) })).rejects.toThrow(/non-empty/);
    const small = new FilesystemVoiceMemoArtifactStore({
      configService: makeConfigService(dataDir), logger: silent, maxBytes: 8,
    });
    await expect(small.create({ buffer: AUDIO })).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
  });

  it('keeps only the context fields a retry prompt needs', async () => {
    const record = await store.create({
      buffer: AUDIO,
      context: {
        currentShow: 'Yoga', activeUsers: ['rider-one'],
        authToken: 'REDACTED-TOKEN-FIXTURE', deviceFingerprint: 'abc',
      },
    });
    expect(record.context).toEqual({ currentShow: 'Yoga', activeUsers: ['rider-one'] });
    expect(JSON.stringify(record)).not.toMatch(/REDACTED-TOKEN-FIXTURE/);
  });

  it('stores an unrecognised container as .bin rather than trusting the client string', () => {
    expect(extensionForMime('audio/../../etc/passwd')).toBe('bin');
    expect(extensionForMime(undefined)).toBe('bin');
  });
});

describe('FilesystemVoiceMemoArtifactStore lifecycle', () => {
  it('round-trips the audio for a retry', async () => {
    const { ref } = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    expect(store.readAudio(null, ref)).toEqual({ buffer: AUDIO, mimeType: 'audio/webm' });
  });

  it('leases an artifact once, so two workers cannot transcribe the same audio', async () => {
    const { ref } = await store.create({ buffer: AUDIO });
    expect(store.claim(null, ref)?.state).toBe(ARTIFACT_STATES.PROCESSING);
    expect(store.claim(null, ref)).toBeNull();
  });

  it('purges the audio while keeping the record, and is safe to call twice', async () => {
    const { ref } = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    expect(store.purgeAudio(null, ref, 123)).toBe(true);
    expect(store.readAudio(null, ref)).toBeNull();
    expect(store.get(null, ref).audioPurgedAt).toBe(123);
    expect(store.purgeAudio(null, ref, 456)).toBe(false);
    expect(store.get(null, ref)).not.toBeNull();
  });

  it('deleteRecord removes the record and any audio still beside it', async () => {
    const { ref } = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    store.deleteRecord(null, ref);
    expect(store.get(null, ref)).toBeNull();
    expect(store.resolveAudioPath(null, ref)).toBeNull();
  });

  it('survives a restart: the record is on disk, not in memory', async () => {
    const { ref } = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    store.update(null, ref, { state: ARTIFACT_STATES.RETRYABLE, nextAttemptAt: 42 });

    const restarted = new FilesystemVoiceMemoArtifactStore({
      configService: makeConfigService(dataDir), logger: silent,
    });
    const record = restarted.get(null, ref);
    expect(record.state).toBe(ARTIFACT_STATES.RETRYABLE);
    expect(record.nextAttemptAt).toBe(42);
    expect(restarted.readAudio(null, ref).buffer).toEqual(AUDIO);
  });

  it('reports an update against a deleted record as nothing to do, not as a crash', async () => {
    const { ref } = await store.create({ buffer: AUDIO });
    store.deleteRecord(null, ref);
    expect(store.update(null, ref, { state: ARTIFACT_STATES.TRANSCRIBED })).toBeNull();
  });
});

describe('FilesystemVoiceMemoArtifactStore listing', () => {
  it('lists newest first and filters by state and session', async () => {
    const a = await store.create({ buffer: AUDIO, sessionId: '20260907120000' });
    const b = await store.create({ buffer: AUDIO, sessionId: '20260907130000' });
    store.update(null, a.ref, { capturedAt: 1000 });
    store.update(null, b.ref, { capturedAt: 2000, state: ARTIFACT_STATES.TRANSCRIBED });

    expect(store.list(null).map((r) => r.ref)).toEqual([b.ref, a.ref]);
    expect(store.list(null, { states: [ARTIFACT_STATES.TRANSCRIBED] }).map((r) => r.ref)).toEqual([b.ref]);
    expect(store.list(null, { sessionId: '20260907120000' }).map((r) => r.ref)).toEqual([a.ref]);
  });

  it('finds audio left behind by a crash between the two writes', async () => {
    const { ref } = await store.create({ buffer: AUDIO, mimeType: 'audio/webm' });
    fs.unlinkSync(path.join(artifactDir(), `${ref}.json`));
    expect(store.listOrphanAudio(null).map((o) => o.ref)).toEqual([ref]);
  });

  it('ignores an unrelated file rather than treating it as somebody\'s recording', async () => {
    fs.mkdirSync(artifactDir(), { recursive: true });
    fs.writeFileSync(path.join(artifactDir(), 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(artifactDir(), 'vm_short.webm'), 'x');
    expect(store.listOrphanAudio(null)).toEqual([]);
  });

  it('sweeps every household that has a data folder, not just the default', async () => {
    fs.mkdirSync(path.join(dataDir, 'household-jones'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'household'), { recursive: true });
    expect(store.householdIds().sort()).toEqual(['default', 'jones']);
  });
});

describe('FilesystemVoiceMemoArtifactStore ref handling', () => {
  it('rejects anything that is not an opaque vm_ ref', () => {
    expect(isValidArtifactRef('vm_' + 'a'.repeat(16))).toBe(true);
    for (const bad of ['va_abc', 'vm_short', '../../etc/passwd', 'vm_../../../secret', '', null]) {
      expect(isValidArtifactRef(bad)).toBe(false);
    }
  });

  it('refuses to resolve a traversal ref to a path outside the artifact directory', () => {
    expect(store.resolveAudioPath(null, '../../../etc/passwd')).toBeNull();
    expect(store.get(null, '../../../etc/passwd')).toBeNull();
  });

  it('treats a record whose ref disagrees with its filename as corrupt', async () => {
    const { ref } = await store.create({ buffer: AUDIO });
    const file = path.join(artifactDir(), `${ref}.json`);
    fs.writeFileSync(file, JSON.stringify({ ref: 'vm_' + 'z'.repeat(16), state: 'transcribed' }));
    expect(store.get(null, ref)).toBeNull();
  });

  it('treats an unparseable record as missing rather than throwing mid-sweep', async () => {
    const { ref } = await store.create({ buffer: AUDIO });
    fs.writeFileSync(path.join(artifactDir(), `${ref}.json`), '{ not json');
    expect(store.get(null, ref)).toBeNull();
    expect(store.list(null)).toEqual([]);
  });
});
