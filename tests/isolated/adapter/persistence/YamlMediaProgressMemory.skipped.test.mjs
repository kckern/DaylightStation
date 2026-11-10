// tests/isolated/adapter/persistence/YamlMediaProgressMemory.skipped.test.mjs
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaProgress } from "../../../../__capabilities/content-catalog/server/domain/entities/MediaProgress.mjs";
import { YamlMediaProgressMemory } from "../../../../__capabilities/playback/server/adapters/persistence/YamlMediaProgressMemory.mjs";

describe('YamlMediaProgressMemory skipped round-trip', () => {
  let tempDir;
  let memory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'media-progress-skipped-'));
    memory = new YamlMediaProgressMemory({ basePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('persists and reads skipped/skippedAt', async () => {
    const state = new MediaProgress({
      contentId: 'plex:649183', playhead: 37, duration: 3600, playCount: 8,
      lastPlayed: '2026-10-29 07:15:48', skipped: true, skippedAt: '2026-10-29T14:15:59.000Z',
    });
    await memory.saveProgress(state, 'plex/17_lectures');
    const loaded = await memory.findProgress('plex:649183', 'plex/17_lectures');
    expect(loaded.skipped).toBe(true);
    expect(loaded.skippedAt).toBe('2026-10-29T14:15:59.000Z');
  });

  test('an unskipped entry reads back as not skipped and writes no skip fields', async () => {
    const state = new MediaProgress({ contentId: 'plex:1', playhead: 40, duration: 600, lastPlayed: '2026-10-29 07:00:00' });
    await memory.saveProgress(state, 'plex/17_lectures');
    const loaded = await memory.findProgress('plex:1', 'plex/17_lectures');
    expect(loaded.skipped).toBe(false);
    expect(loaded.skippedAt).toBeNull();
  });
});
