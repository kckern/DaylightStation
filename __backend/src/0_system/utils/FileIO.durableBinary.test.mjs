// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeBinaryAtomic } from './FileIO.mjs';
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-binary-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { force: true, recursive: true }); });
describe('durable binary publication', () => {
  it('flushes newly created ancestor directory entries as well as file contents', () => {
    const synced = [];
    const sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { synced.push(fs.readlinkSync(`/proc/self/fd/${fd}`)); sync(fd); });
    const target = path.join(root, 'new-game', 'blobs', 'artifact.bin');
    writeBinaryAtomic(target, Buffer.from('progress'), { durable: true });
    expect(fs.readFileSync(target, 'utf8')).toBe('progress');
    expect(synced).toContain(root);
    expect(synced).toContain(path.join(root, 'new-game'));
    expect(synced).toContain(path.join(root, 'new-game', 'blobs'));
  });
  it('preserves the previous published bytes when flushing staged contents fails', () => {
    const target = path.join(root, 'head.json');
    fs.writeFileSync(target, 'previous');
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw Object.assign(new Error('disk error'), { code: 'EIO' }); });
    expect(() => writeBinaryAtomic(target, Buffer.from('new'), { durable: true })).toThrow('disk error');
    expect(fs.readFileSync(target, 'utf8')).toBe('previous');
    expect(fs.readdirSync(root)).toEqual(['head.json']);
  });
});
