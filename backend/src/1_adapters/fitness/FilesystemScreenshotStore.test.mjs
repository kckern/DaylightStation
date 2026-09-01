import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesystemScreenshotStore } from './FilesystemScreenshotStore.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('FilesystemScreenshotStore', () => {
  it('preserves legacy filename, path, bytes, MIME, and session snapshot shapes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-store-'));
    roots.push(root);
    const screenshotsDir = path.join(root, 'screenshots');
    const addSnapshot = vi.fn(async () => {});
    const store = new FilesystemScreenshotStore({ sessionService: {
      getStoragePaths: () => ({
        sessionDate: '2026-08-28', screenshotsDir,
        screenshotsRelativeBase: 'fitness/2026-08-28/screenshots',
      }),
      addSnapshot,
    } });
    const result = await store.saveCapture({
      sessionId: '20260828abc', role: 'player', index: 7,
      image: 'data:image/png;base64,YWJj', mediaType: 'IMAGE/PNG', timestamp: 1234,
    });
    expect(result).toEqual({
      kind: 'stored', sessionRef: '20260828abc',
      capture: {
        order: 7, resourceName: '2026-08-28_player_0007.png',
        resourceRef: 'fitness/2026-08-28/screenshots/2026-08-28_player_0007.png',
        capturedAt: 1234, byteLength: 3, role: 'player', mediaType: 'image/png',
      },
    });
    expect(fs.readFileSync(path.join(screenshotsDir, '2026-08-28_player_0007.png')).toString()).toBe('abc');
    expect(addSnapshot).toHaveBeenCalledWith('20260828abc', {
      index: 7, filename: '2026-08-28_player_0007.png',
      path: 'fitness/2026-08-28/screenshots/2026-08-28_player_0007.png',
      timestamp: 1234, size: 3, role: 'player',
    }, undefined, 1234);
  });

  // Regression: a capture loop that restarts mid-session replays index 0..N. The
  // filename is derived only from date+role+index, so the replay used to overwrite
  // the earlier run's frames on disk AND evict their manifest rows (dedupe by
  // filename) — silently destroying minutes of footage. Session 20260831132151 lost
  // its first 13.8 minutes this way.
  it('does not let a restarted index overwrite a distinct earlier capture', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-store-'));
    roots.push(root);
    const screenshotsDir = path.join(root, 'screenshots');
    const addSnapshot = vi.fn(async () => {});
    const logger = { warn: vi.fn(), info: vi.fn() };
    const store = new FilesystemScreenshotStore({
      sessionService: {
        getStoragePaths: () => ({
          sessionDate: '2026-08-28', screenshotsDir,
          screenshotsRelativeBase: 'fitness/2026-08-28/screenshots',
        }),
        addSnapshot,
      },
      logger,
    });
    const capture = (index, timestamp, image) => store.saveCapture({
      sessionId: '20260828abc', role: 'camera', index, timestamp,
      image: `data:image/jpeg;base64,${image}`, mediaType: 'image/jpeg',
    });

    const first = await capture(0, 1000, 'YWFh');   // 'aaa' — original run
    const replay = await capture(0, 9000, 'YmJi');  // 'bbb' — restarted run

    // The original frame survives, untouched.
    expect(fs.readFileSync(path.join(screenshotsDir, '2026-08-28_0000.jpg')).toString()).toBe('aaa');
    expect(first.capture.resourceName).toBe('2026-08-28_0000.jpg');
    // The replay lands on a free slot instead of clobbering slot 0.
    expect(replay.capture.resourceName).not.toBe('2026-08-28_0000.jpg');
    expect(fs.readFileSync(path.join(screenshotsDir, replay.capture.resourceName)).toString()).toBe('bbb');
    // Both frames are in the manifest, with their own timestamps.
    expect(addSnapshot.mock.calls.map(c => c[1].timestamp)).toEqual([1000, 9000]);
    // The collision is visible, not silent.
    expect(logger.warn).toHaveBeenCalledWith('fitness.screenshot.index_collision',
      expect.objectContaining({ role: 'camera', requestedIndex: 0 }));
  });

  it('still overwrites in place when the same capture is retried', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-store-'));
    roots.push(root);
    const screenshotsDir = path.join(root, 'screenshots');
    const addSnapshot = vi.fn(async () => {});
    const store = new FilesystemScreenshotStore({
      sessionService: {
        getStoragePaths: () => ({
          sessionDate: '2026-08-28', screenshotsDir,
          screenshotsRelativeBase: 'fitness/2026-08-28/screenshots',
        }),
        addSnapshot,
      },
    });
    const args = {
      sessionId: '20260828abc', role: 'camera', index: 3, timestamp: 5000,
      image: 'data:image/jpeg;base64,YWFh', mediaType: 'image/jpeg',
    };
    const a = await store.saveCapture(args);
    const b = await store.saveCapture(args);
    expect(b.capture.resourceName).toBe(a.capture.resourceName);
    expect(fs.readdirSync(screenshotsDir)).toEqual(['2026-08-28_0003.jpg']);
  });
});
