import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemCardLadderRecordings } from "./FilesystemCardLadderRecordings.mjs";

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
  it('lists a day\'s takes by word and number, and opens one by its number', () => {
    const recordings = new FilesystemCardLadderRecordings({ rootDir: root });
    const at = { package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22' };
    recordings.save({ ...at, wordId: 'pul', buffer: Buffer.from('p1') });
    recordings.save({ ...at, wordId: 'gawi', buffer: Buffer.from('g1') });
    recordings.save({ ...at, wordId: 'gawi', buffer: Buffer.from('g2'), ext: 'ogg' });
    expect(recordings.list(at)).toEqual([
      { wordId: 'gawi', take: 1, ext: 'webm' }, { wordId: 'gawi', take: 2, ext: 'ogg' }, { wordId: 'pul', take: 1, ext: 'webm' },
    ]);
    expect(recordings.open({ ...at, wordId: 'gawi', take: 2 })).toMatchObject({ contentType: 'audio/ogg' });
    expect(recordings.open({ ...at, wordId: 'gawi', take: 3 })).toBeNull();
    expect(recordings.open({ ...at, wordId: 'gawi', take: 0 })).toBeNull();
    expect(recordings.list({ ...at, day: '2026-09-23' })).toEqual([]);
    expect(recordings.list({ ...at, learnerId: '../x' })).toEqual([]);
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

describe('FilesystemCardLadderRecordings — the one-time move out of recordings/word-ladder', () => {
  it('copies a learner\'s takes on first use, numbers new takes after them, and leaves the old ones alone', async () => {
    const { mkdir, writeFile, readdir } = await import('node:fs/promises');
    const legacyRootDir = path.join(root, 'word-ladder');
    const rootDir = path.join(root, 'card-ladder');
    await mkdir(path.join(legacyRootDir, 'korean-vocab/kid/2026-09-22'), { recursive: true });
    await writeFile(path.join(legacyRootDir, 'korean-vocab/kid/2026-09-22/gawi-1.webm'), 'old');
    const recordings = new FilesystemCardLadderRecordings({ rootDir, legacyRootDir });
    expect(recordings.latest({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi' })).toMatchObject({ contentType: 'audio/webm' });
    expect(recordings.save({ package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('new') })).toMatchObject({ take: 2 });
    expect(await readFile(path.join(rootDir, 'korean-vocab/kid/2026-09-22/gawi-1.webm'), 'utf8')).toBe('old');
    expect(await readdir(path.join(legacyRootDir, 'korean-vocab/kid/2026-09-22'))).toEqual(['gawi-1.webm']);
    expect(await readFile(path.join(legacyRootDir, 'korean-vocab/kid/2026-09-22/gawi-1.webm'), 'utf8')).toBe('old');
  });
});

