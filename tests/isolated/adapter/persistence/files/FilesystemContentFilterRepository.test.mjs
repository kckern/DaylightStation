import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { FilesystemContentFilterRepository } from '#adapters/persistence/files/FilesystemContentFilterRepository.mjs';
import { IContentFilterRepository } from '#apps/content-filter/ports/IContentFilterRepository.mjs';

describe('FilesystemContentFilterRepository', () => {
  let tmpRoot;

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  });

  function createRepository() {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'content-filter-repository-'));
    const householdDir = path.join(tmpRoot, 'household');
    const mediaDir = path.join(tmpRoot, 'media');
    mkdirSync(path.join(householdDir, 'content-filter', 'profiles'), { recursive: true });
    mkdirSync(path.join(householdDir, 'content-filter', 'overrides'), { recursive: true });
    mkdirSync(path.join(mediaDir, 'content-filter', 'edl'), { recursive: true });
    const logger = { warn: vi.fn() };
    return {
      householdDir,
      mediaDir,
      logger,
      repository: new FilesystemContentFilterRepository({ householdDir, mediaDir, logger }),
    };
  }

  it('extends the application repository port and reads from both roots', async () => {
    const { householdDir, mediaDir, repository } = createRepository();
    writeFileSync(
      path.join(mediaDir, 'content-filter', 'edl', '349222.edl.yml'),
      yaml.dump({ cues: [{ id: 'c1' }] }),
    );
    writeFileSync(
      path.join(householdDir, 'content-filter', 'profiles', 'family.yml'),
      yaml.dump({ name: 'family' }),
    );
    writeFileSync(
      path.join(householdDir, 'content-filter', 'overrides', '349222.yml'),
      yaml.dump({ source: 'manual' }),
    );

    expect(repository).toBeInstanceOf(IContentFilterRepository);
    await expect(repository.getEdl('349222')).resolves.toEqual({ cues: [{ id: 'c1' }] });
    await expect(repository.getProfile('family')).resolves.toEqual({ name: 'family' });
    await expect(repository.getOverride('349222')).resolves.toEqual({ source: 'manual' });
  });

  it('returns null for missing files and logs malformed YAML', async () => {
    const { mediaDir, logger, repository } = createRepository();
    await expect(repository.getEdl('missing')).resolves.toBeNull();
    writeFileSync(
      path.join(mediaDir, 'content-filter', 'edl', 'broken.edl.yml'),
      'cues: [unterminated',
    );

    await expect(repository.getEdl('broken')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'content-filter.read.error',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});
