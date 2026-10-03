// tests/isolated/adapter/persistence/YamlMediaProgressMemory.spots.test.mjs
//
// Per-screen spots ride beside the legacy single playhead in the same record.
// Writers that know nothing about spots (UpdateContentProgress, ProgressSync
// bookmarks) must not erase them.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';

describe('YamlMediaProgressMemory per-screen spots', () => {
  let tempDir;
  let memory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'media-progress-spots-'));
    memory = new YamlMediaProgressMemory({ basePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const spots = {
    'fleet:livingroom-tv': { playhead: 4800, duration: 7200, percent: 67, lastPlayed: '2026-10-01 21:00:00' },
    'browser:kid': { playhead: 720, duration: 7200, percent: 10, lastPlayed: '2026-10-02 08:00:00' },
  };

  test('round-trips spots and lastDevice', async () => {
    await memory.saveProgress(new MediaProgress({
      contentId: 'plex:1', playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00', spots, lastDevice: 'browser:kid',
    }), 'plex/6_movies');
    const loaded = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(loaded.spots).toEqual(spots);
    expect(loaded.lastDevice).toBe('browser:kid');
    expect(loaded.playhead).toBe(720);
  });

  test('a spot-unaware write keeps the stored spots', async () => {
    await memory.saveProgress(new MediaProgress({
      contentId: 'plex:1', playhead: 720, duration: 7200, spots, lastDevice: 'browser:kid',
    }), 'plex/6_movies');
    // e.g. ProgressSyncService bookmark: rebuilt without spots
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 900, duration: 7200 }), 'plex/6_movies');
    const loaded = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(loaded.playhead).toBe(900);
    expect(loaded.spots).toEqual(spots);
    expect(loaded.lastDevice).toBe('browser:kid');
  });

  test('an explicit empty spots map clears them (mark watched/unwatched)', async () => {
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 720, duration: 7200, spots, lastDevice: 'browser:kid' }), 'plex/6_movies');
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 0, duration: 7200, spots: {} }), 'plex/6_movies');
    const loaded = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(loaded.spots).toEqual({});
    expect(loaded.lastDevice).toBe('browser:kid');
  });

  test('an explicit null lastDevice clears it (mark watched/unwatched)', async () => {
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 720, duration: 7200, spots, lastDevice: 'browser:kid' }), 'plex/6_movies');
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 0, duration: 7200, spots: {}, lastDevice: null }), 'plex/6_movies');
    expect((await memory.findProgress('plex:1', 'plex/6_movies')).lastDevice).toBeNull();
  });

  test('legacy records read with spots undefined and lastDevice null', async () => {
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:2', playhead: 10, duration: 100 }), 'plex');
    const loaded = await memory.findProgress('plex:2', 'plex');
    expect(loaded.spots).toBeUndefined();
    expect(loaded.lastDevice).toBeNull();
  });

  test('listAllProgress walks every namespace and skips Dropbox conflicted copies', async () => {
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 10, duration: 100 }), 'plex/6_movies');
    await memory.saveProgress(new MediaProgress({ contentId: 'files:a', playhead: 10, duration: 100 }), 'files');
    mkdirSync(join(tempDir, 'plex'), { recursive: true });
    writeFileSync(join(tempDir, "plex/6_movies (Laptop's conflicted copy 2026-09-01).yml"), 'plex:99:\n  playhead: 1\n');
    const all = await memory.listAllProgress();
    const ids = all.map((e) => `${e.namespaceId}|${e.progress.contentId}`).sort();
    expect(ids).toEqual(['files|files:a', 'plex/6_movies|plex:1']);
  });

  test('updateSpots rewrites only spots/lastDevice against the record as stored now', async () => {
    await memory.saveProgress(new MediaProgress({
      contentId: 'plex:1', playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00', spots, lastDevice: 'browser:kid',
    }), 'plex/6_movies');
    // A play/log write lands after a caller listed the records but before it updates.
    await memory.saveProgress(new MediaProgress({
      contentId: 'plex:1', playhead: 900, duration: 7200, lastPlayed: '2026-10-02 08:05:00',
      spots: { ...spots, 'browser:kid': { ...spots['browser:kid'], playhead: 900 } }, lastDevice: 'browser:kid',
    }), 'plex/6_movies');
    const seen = [];
    const changed = await memory.updateSpots('plex:1', 'plex/6_movies', (current) => {
      seen.push(current);
      const next = { ...current.spots, 'browser:kitchen': current.spots['browser:kid'] };
      delete next['browser:kid'];
      return { spots: next, lastDevice: 'browser:kitchen' };
    });
    expect(changed).toBe(true);
    expect(seen[0].spots['browser:kid'].playhead).toBe(900);
    const loaded = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(loaded.playhead).toBe(900);
    expect(loaded.spots['browser:kitchen'].playhead).toBe(900);
    expect(loaded.spots['browser:kid']).toBeUndefined();
    expect(loaded.lastDevice).toBe('browser:kitchen');
  });

  test('updateSpots: a missing record or a null answer writes nothing', async () => {
    expect(await memory.updateSpots('plex:nope', 'plex/6_movies', () => ({ spots: {} }))).toBe(false);
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:2', playhead: 1, duration: 10, spots }), 'plex/6_movies');
    expect(await memory.updateSpots('plex:2', 'plex/6_movies', () => null)).toBe(false);
    expect((await memory.findProgress('plex:2', 'plex/6_movies')).spots).toEqual(spots);
  });
});
