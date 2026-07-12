import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FsMidiLibrary } from '#adapters/pianoaudio/FsMidiLibrary.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let root, sourceDir, destDir;

function writeFile(p, content, mtimeMs) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtimeMs != null) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pianoaudio-lib-'));
  sourceDir = path.join(root, 'history', 'piano');
  destDir = path.join(root, 'media', 'audio', 'piano');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('FsMidiLibrary.listPending', () => {
  it('returns only midis missing a mirror mp3, newest-first, with mirrored dest paths', async () => {
    // older midi, no mp3 yet
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/take1.mid'), 'MID', 1_000_000);
    // newer midi, no mp3 yet
    writeFile(path.join(sourceDir, 'jamcorder/2026/2026-01/s.mid'), 'MID', 5_000_000);
    // midi that already has a mirror mp3 → excluded
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/done.mid'), 'MID', 9_000_000);
    writeFile(path.join(destDir, 'kckern/2026-01-02/done.mp3'), 'MP3');
    // a non-midi → ignored
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/notes.txt'), 'x');

    // inject fixed short/dense stats so these fixtures aren't parsed as real SMF
    const lib = new FsMidiLibrary({ sourceDir, destDir, logger: silent, midiStats: () => ({ durationSeconds: 60, noteCount: 100 }) });
    const pending = await lib.listPending();

    expect(pending).toEqual([
      {
        midiPath: path.join(sourceDir, 'jamcorder/2026/2026-01/s.mid'),
        mp3Path: path.join(destDir, 'jamcorder/2026/2026-01/s.mp3'),
      },
      {
        midiPath: path.join(sourceDir, 'kckern/2026-01-02/take1.mid'),
        mp3Path: path.join(destDir, 'kckern/2026-01-02/take1.mp3'),
      },
    ]);
  });

  it('returns an empty array when the source dir does not exist', async () => {
    const lib = new FsMidiLibrary({ sourceDir: path.join(root, 'nope'), destDir, logger: silent });
    expect(await lib.listPending()).toEqual([]);
  });

  it('skips junk (long-and-sparse stuck note; note-less) but keeps a real long dense session', async () => {
    writeFile(path.join(sourceDir, 'ok/short.mid'), 'MID', 2_000_000);
    writeFile(path.join(sourceDir, 'ok/long-session.mid'), 'MID', 6_000_000); // long but dense → real
    writeFile(path.join(sourceDir, 'junk/stuck.mid'), 'MID', 3_000_000);       // long + sparse → junk
    writeFile(path.join(sourceDir, 'junk/empty.mid'), 'MID', 4_000_000);       // no notes → junk
    const stats = {
      [path.join(sourceDir, 'ok/short.mid')]: { durationSeconds: 120, noteCount: 300 },
      [path.join(sourceDir, 'ok/long-session.mid')]: { durationSeconds: 9888, noteCount: 20211 },
      [path.join(sourceDir, 'junk/stuck.mid')]: { durationSeconds: 5670, noteCount: 3 },
      [path.join(sourceDir, 'junk/empty.mid')]: { durationSeconds: 30, noteCount: 0 },
    };
    const lib = new FsMidiLibrary({
      sourceDir, destDir, logger: silent,
      junkMinSeconds: 1800, junkMinNotes: 200,
      midiStats: (p) => stats[p],
    });

    const pending = await lib.listPending();

    // newest-first by mtime: long-session (6M) then short (2M); junk excluded
    expect(pending).toEqual([
      { midiPath: path.join(sourceDir, 'ok/long-session.mid'), mp3Path: path.join(destDir, 'ok/long-session.mp3') },
      { midiPath: path.join(sourceDir, 'ok/short.mid'), mp3Path: path.join(destDir, 'ok/short.mp3') },
    ]);
  });

  it('includes a midi whose stats cannot be parsed (converter timeout is the backstop)', async () => {
    writeFile(path.join(sourceDir, 'weird/unparseable.mid'), 'NOTMIDI', 4_000_000);
    const lib = new FsMidiLibrary({
      sourceDir, destDir, logger: silent,
      junkMinSeconds: 1800, junkMinNotes: 200,
      midiStats: () => { throw new Error('bad SMF'); },
    });

    const pending = await lib.listPending();

    expect(pending).toEqual([
      { midiPath: path.join(sourceDir, 'weird/unparseable.mid'), mp3Path: path.join(destDir, 'weird/unparseable.mp3') },
    ]);
  });
});
