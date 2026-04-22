// tests/isolated/adapter/camera/HlsStreamManager.test.mjs
import { describe, test, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { mkdir, writeFile, access, rm } from 'fs/promises';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';

function createFakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => { proc.killed = true; proc.emit('exit', 0, null); };
  return proc;
}

describe('HlsStreamManager — concurrent ensureStream dedup', () => {
  afterEach(async () => {
    await rm(path.join(os.tmpdir(), 'camera'), { recursive: true, force: true });
  });

  test('every caller sees the playlist on disk at the moment ensureStream resolves', async () => {
    let spawnCount = 0;

    const fakeSpawn = (cmd, args) => {
      spawnCount++;
      const proc = createFakeProc();
      const playlistPath = args[args.length - 1];

      // Simulate ffmpeg producing the playlist after a delay
      setTimeout(async () => {
        await mkdir(path.dirname(playlistPath), { recursive: true });
        await writeFile(playlistPath, '#EXTM3U\n#EXT-X-VERSION:3\n');
      }, 200);

      return proc;
    };

    const manager = new HlsStreamManager({ spawn: fakeSpawn });

    // Each worker checks playlist existence AT THE MOMENT its ensureStream resolves —
    // not after Promise.all, which would mask the race (the slow first caller makes
    // the file exist before the combined await returns, hiding the second caller's bug).
    async function ensureAndCheckPlaylist() {
      const dir = await manager.ensureStream('test-stream', 'rtsp://fake');
      const playlistPath = path.join(dir, 'stream.m3u8');
      try {
        await access(playlistPath);
        return { dir, playlistExists: true };
      } catch {
        return { dir, playlistExists: false };
      }
    }

    const [r1, r2] = await Promise.all([ensureAndCheckPlaylist(), ensureAndCheckPlaylist()]);

    expect(spawnCount).toBe(1);
    expect(r1.dir).toBe(r2.dir);
    expect(r1.playlistExists).toBe(true);  // first caller awaited #waitForPlaylist → always sees file
    expect(r2.playlistExists).toBe(true);  // second caller — fails without the readyPromise dedup

    manager.stopAll();
  });
});
