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
});
