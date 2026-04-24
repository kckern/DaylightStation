// tests/isolated/adapter/persistence/YamlMediaProgressMemory.completedAt.test.mjs
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';

describe('YamlMediaProgressMemory completedAt round-trip', () => {
  let tempDir;
  let memory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'media-progress-completedat-'));
    memory = new YamlMediaProgressMemory({ basePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('persists and reads completedAt through YAML round-trip', async () => {
    const state = new MediaProgress({
      contentId: 'plex:674498',
      playhead: 650,
      duration: 678,
      playCount: 1,
      lastPlayed: '2026-04-20 06:07:44',
      watchTime: 735,
      completedAt: '2026-04-20 06:07:44'
    });
    await memory.set(state, 'plex/14_fitness');
    const loaded = await memory.get('plex:674498', 'plex/14_fitness');
    expect(loaded).not.toBeNull();
    expect(loaded.completedAt).toBe('2026-04-20 06:07:44');
  });

  test('returns null completedAt for unstamped entries', async () => {
    const state = new MediaProgress({
      contentId: 'plex:100',
      playhead: 40,
      duration: 678,
      playCount: 1,
      lastPlayed: '2026-04-20 06:07:44'
    });
    await memory.set(state, 'plex/14_fitness');
    const loaded = await memory.get('plex:100', 'plex/14_fitness');
    expect(loaded.completedAt).toBeNull();
  });
});
