import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';
import { YamlMediaMemoryValidationStore } from './YamlMediaMemoryValidationStore.mjs';

const temporaryDirectories = [];
const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-memory-validation-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('YamlMediaMemoryValidationStore', () => {
  it('projects canonical plex keys and safely renames the persisted key', async () => {
    const root = temporaryDirectory();
    const file = path.join(root, '8_tv-shows');
    saveYaml(file, {
      'plex:59498': { playhead: 437, lastPlayed: '2026-02-23 09:21:57' },
    });
    const store = new YamlMediaMemoryValidationStore({ basePath: root });

    await expect(store.getAllEntries()).resolves.toEqual([{
      id: '59498', libraryId: '8', playhead: 437, lastPlayed: '2026-02-23 09:21:57',
    }]);
    await store.updateId('59498', '60000', { oldPlexIds: [59498] });

    expect(loadYamlSafe(file)).toEqual({
      'plex:60000': { playhead: 437, lastPlayed: '2026-02-23 09:21:57', oldPlexIds: [59498] },
    });
  });

  it('refuses to overwrite an existing destination key', async () => {
    const root = temporaryDirectory();
    const file = path.join(root, '14_fitness');
    const original = {
      'plex:10': { playhead: 1 },
      'plex:20': { playhead: 2 },
    };
    saveYaml(file, original);
    const store = new YamlMediaMemoryValidationStore({ basePath: root });
    await store.getAllEntries();

    await expect(store.updateId('10', '20')).rejects.toThrow(/Refusing to overwrite/);
    expect(loadYamlSafe(file)).toEqual(original);
  });
});
