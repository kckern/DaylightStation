import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemCardLadderRecordings } from './FilesystemCardLadderRecordings.mjs';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-rec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('FilesystemCardLadderRecordings', () => {
  it('numbers takes per word per study day under {package}/{learner}/{day}/{word}-{n}.{ext}', async () => {
    const recordings = new FilesystemCardLadderRecordings({ rootDir: root });
    expect(recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('one') })).toMatchObject({ take: 1 });
    expect(recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('two') })).toMatchObject({ take: 2 });
    expect(await readFile(path.join(root, 'korean-vocab/kid/2026-09-22/gawi-2.webm'), 'utf8')).toBe('two');
    expect(recordings.latest({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi' })).toMatchObject({ contentType: 'audio/webm' });
    expect(recordings.latest({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'pul' })).toBeNull();
  });
  it('keeps packages apart: the same word id in two packages never shares a take counter', async () => {
    const recordings = new FilesystemCardLadderRecordings({ rootDir: root });
    recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'hola', buffer: Buffer.from('ko') });
    expect(recordings.save({ package: 'spanish-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'hola', buffer: Buffer.from('es') })).toMatchObject({ take: 1 });
    expect(await readFile(path.join(root, 'spanish-vocab/kid/2026-09-22/hola-1.webm'), 'utf8')).toBe('es');
  });
  it('refuses unsafe ids, days and extensions', () => {
    const recordings = new FilesystemCardLadderRecordings({ rootDir: root });
    expect(() => recordings.save({ package: 'korean-vocab', learnerId: '../x', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '22-09-2026', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x'), ext: 'exe' })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ package: '../x', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
  });
});
