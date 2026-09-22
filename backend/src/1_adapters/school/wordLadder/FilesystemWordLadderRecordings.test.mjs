import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemWordLadderRecordings } from './FilesystemWordLadderRecordings.mjs';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-rec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('FilesystemWordLadderRecordings', () => {
  it('numbers takes per word per study day under {learner}/{day}/{word}-{n}.{ext}', async () => {
    const recordings = new FilesystemWordLadderRecordings({ rootDir: root });
    expect(recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('one') })).toMatchObject({ take: 1 });
    expect(recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('two') })).toMatchObject({ take: 2 });
    expect(await readFile(path.join(root, 'kid/2026-09-22/gawi-2.webm'), 'utf8')).toBe('two');
    expect(recordings.latest({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi' })).toMatchObject({ contentType: 'audio/webm' });
    expect(recordings.latest({ learnerId: 'kid', day: '2026-09-22', wordId: 'pul' })).toBeNull();
  });
  it('refuses unsafe ids, days and extensions', () => {
    const recordings = new FilesystemWordLadderRecordings({ rootDir: root });
    expect(() => recordings.save({ learnerId: '../x', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ learnerId: 'kid', day: '22-09-2026', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x'), ext: 'exe' })).toThrow(/invalid recording address/);
  });
});
