import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FilesystemScreensRepository } from '#adapters/persistence/files/FilesystemScreensRepository.mjs';
import { IScreensRepository } from '#apps/screens/ports/IScreensRepository.mjs';

describe('FilesystemScreensRepository', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it('extends the application-owned screens repository port', () => {
    root = mkdtempSync(path.join(tmpdir(), 'screens-repository-'));
    mkdirSync(path.join(root, 'screens'), { recursive: true });

    const repository = new FilesystemScreensRepository({ householdDir: root });

    expect(repository).toBeInstanceOf(IScreensRepository);
  });
});
