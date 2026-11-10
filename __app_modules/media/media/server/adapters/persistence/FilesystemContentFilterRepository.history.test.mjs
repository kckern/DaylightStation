import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemContentFilterRepository } from './FilesystemContentFilterRepository.mjs';

describe('FilesystemContentFilterRepository review history', () => {
  it('appends entries in order and reads the newest `limit`', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-hist-'));
    const repo = new FilesystemContentFilterRepository({ householdDir: dir, mediaDir: dir });
    expect(await repo.readReviewHistory('9')).toEqual([]);
    for (const n of [1, 2, 3]) await repo.appendReviewHistory('9', { n });
    expect(await repo.readReviewHistory('9')).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(await repo.readReviewHistory('9', { limit: 2 })).toEqual([{ n: 2 }, { n: 3 }]);
    expect(fs.existsSync(path.join(dir, 'content-filter/review-history/9.yml'))).toBe(true);
  });
});
