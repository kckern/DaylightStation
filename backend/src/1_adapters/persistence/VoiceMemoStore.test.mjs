import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VoiceMemoStore, isValidAudioRef, extensionForMime, AUDIO_REF_PATTERN } from './VoiceMemoStore.mjs';

function makeDataService(dir) {
  return { user: { resolveDir: (rel, userId) => path.join(dir, 'users', userId, rel) } };
}

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicememo-'));
  store = new VoiceMemoStore({
    dataService: makeDataService(dir),
    logger: { warn() {}, info() {}, debug() {} },
  });
});

const AUDIO = Buffer.from('not really opus, but bytes are bytes');
const audioDir = () => path.join(dir, 'users', 'alice', 'lifelog/nutrition/audio');

describe('VoiceMemoStore', () => {
  it('save() writes the bytes and returns a va_-prefixed ref matching the allowlist', async () => {
    const audioRef = await store.save('alice', AUDIO, { mimeType: 'audio/webm;codecs=opus' });
    expect(AUDIO_REF_PATTERN.test(audioRef)).toBe(true);
    expect(isValidAudioRef(audioRef)).toBe(true);
    // The codec param is dropped; the container extension is kept.
    const file = path.join(audioDir(), `${audioRef}.webm`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file)).toEqual(AUDIO);
  });

  it('lands beside the photos, under the same per-user lifelog root', async () => {
    await store.save('alice', AUDIO, { mimeType: 'audio/webm' });
    expect(fs.existsSync(audioDir())).toBe(true);
  });

  it('keeps whichever container the capturing browser produced', async () => {
    for (const [mime, ext] of [['audio/mp4', 'm4a'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/mpeg', 'mp3']]) {
      const ref = await store.save('alice', AUDIO, { mimeType: mime });
      expect(fs.existsSync(path.join(audioDir(), `${ref}.${ext}`))).toBe(true);
    }
  });

  it('an unrecognised mime stores as .bin rather than a filename the client chose', async () => {
    expect(extensionForMime('audio/../../evil')).toBe('bin');
    expect(extensionForMime(undefined)).toBe('bin');
    const ref = await store.save('alice', AUDIO, { mimeType: 'application/x-weird' });
    expect(fs.existsSync(path.join(audioDir(), `${ref}.bin`))).toBe(true);
  });

  it('refuses an empty buffer and a missing userId rather than writing a stub', async () => {
    await expect(store.save('alice', Buffer.alloc(0))).rejects.toThrow(/non-empty Buffer/);
    await expect(store.save('', AUDIO)).rejects.toThrow(/userId/);
  });

  it('two saves never collide — each ref is its own file', async () => {
    const a = await store.save('alice', AUDIO, { mimeType: 'audio/webm' });
    const b = await store.save('alice', AUDIO, { mimeType: 'audio/webm' });
    expect(a).not.toBe(b);
    expect(fs.readdirSync(audioDir())).toHaveLength(2);
  });

  it('resolvePath() finds a stored memo whatever extension it kept', async () => {
    const ref = await store.save('alice', AUDIO, { mimeType: 'audio/mp4' });
    expect(store.resolvePath('alice', ref)).toBe(path.join(audioDir(), `${ref}.m4a`));
  });

  // A traversal ref that names a file which does not exist returns null for the
  // boring reason, and would keep returning null with every guard deleted. So
  // the escape target is a REAL file, planted one directory up in the same
  // per-user tree: with the guards gone this ref resolves to it and the
  // assertion fails, which is the only way this test means anything.
  it('resolvePath() refuses to escape the audio directory even when the target really exists', async () => {
    const sibling = path.join(dir, 'users', 'alice', 'lifelog/nutrition/photos');
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'secret.webm'), 'not yours');
    fs.mkdirSync(audioDir(), { recursive: true });

    // Sanity: the naive join really would reach it — otherwise this proves nothing.
    expect(fs.existsSync(path.join(audioDir(), '../photos/secret.webm'))).toBe(true);

    for (const ref of ['../photos/secret', 'va_../photos/secret', '../../../../etc/passwd']) {
      expect(store.resolvePath('alice', ref)).toBeNull();
    }
  });

  it('resolvePath() returns null — never throws — for an unknown or malformed ref', async () => {
    for (const ref of ['ph_abc', '', null, undefined, 'va_neverStored']) {
      expect(store.resolvePath('alice', ref)).toBeNull();
    }
    expect(store.resolvePath('', 'va_abc')).toBeNull();
  });

  it('is not a delete surface — a failed transcription\'s audio is what a retry needs', () => {
    expect(store.remove).toBeUndefined();
    expect(store.delete).toBeUndefined();
  });
});
