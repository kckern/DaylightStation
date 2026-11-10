import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemContentFilterRepository } from './FilesystemContentFilterRepository.mjs';

describe('FilesystemContentFilterRepository.getMatchIndexWrittenAt', () => {
  const make = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-idx-'));
    return { dir, repo: new FilesystemContentFilterRepository({ householdDir: dir, mediaDir: dir }) };
  };
  it('is null when the index file is missing (never 1970)', async () => {
    expect(await make().repo.getMatchIndexWrittenAt()).toBeNull();
  });
  it('is the file mtime as ISO when present', async () => {
    const { dir, repo } = make();
    fs.mkdirSync(path.join(dir, 'content-filter'), { recursive: true });
    const f = path.join(dir, 'content-filter/plex-vidangel-map.yml');
    fs.writeFileSync(f, 'map: {}\n');
    fs.utimesSync(f, new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T00:00:00Z'));
    expect(await repo.getMatchIndexWrittenAt()).toBe('2026-06-30T00:00:00.000Z');
  });
});
