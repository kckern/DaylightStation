import { spawn as defaultSpawn } from 'child_process';
import { mkdir, rm, access } from 'fs/promises';
import os from 'os';
import path from 'path';

const INACTIVITY_TIMEOUT_MS = 30_000;
const PLAYLIST_POLL_MS = 500;
const PLAYLIST_TIMEOUT_MS = 15_000;

/**
 * HlsStreamManager — generic RTSP-to-HLS lifecycle manager.
 *
 * Implements the IStreamAdapter port. Receives an RTSP URL from the
 * application layer and manages the ffmpeg subprocess that transcodes
 * it into HLS segments. Has NO knowledge of any specific camera vendor.
 *
 * One ffmpeg process per streamId. Multiple clients share the same HLS output.
 * Streams auto-stop after 30 seconds of inactivity (no touch/ensureStream calls).
 */
export class HlsStreamManager {
  /** @type {Map<string, { proc: import('child_process').ChildProcess | null, dir: string, timer: NodeJS.Timeout, readyPromise: Promise<void> }>} */
  #streams = new Map();
  #logger;
  #spawn;

  /**
   * @param {{ logger?: object, spawn?: Function }} options
   */
  constructor({ logger = console, spawn = defaultSpawn } = {}) {
    this.#logger = logger;
    this.#spawn = spawn;
  }

  /**
   * Ensure an HLS stream is running for the given streamId.
   * If already running, resets the inactivity timer and returns the directory.
   * Otherwise, spawns ffmpeg and waits for the .m3u8 playlist to appear.
   *
   * @param {string} streamId
   * @param {string} rtspUrl
   * @returns {Promise<string>} path to the directory containing stream.m3u8
   */
  async ensureStream(streamId, rtspUrl) {
    const existing = this.#streams.get(streamId);
    if (existing) {
      this.#resetTimer(streamId);
      // Dedup: every caller (first or Nth) awaits the same playlist-ready promise
      // before the adapter resolves. This guarantees the router's subsequent
      // readFile of stream.m3u8 will not race with ffmpeg's first write.
      await existing.readyPromise;
      return existing.dir;
    }

    const dir = path.join(os.tmpdir(), 'camera', streamId);
    const playlistPath = path.join(dir, 'stream.m3u8');

    // Register the entry synchronously (before any await) so that concurrent
    // callers hitting ensureStream within the same tick see the existing entry
    // and await the same readyPromise rather than spawning a second ffmpeg.
    let resolveReady, rejectReady;
    const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    // Prevent an UnhandledPromiseRejection when the first/lone caller's setup
    // fails and no one else is awaiting readyPromise. Concurrent callers still
    // see the rejection through their own `await existing.readyPromise`.
    readyPromise.catch(() => {});
    const entry = { proc: null, dir, timer: null, readyPromise };
    this.#streams.set(streamId, entry);
    this.#resetTimer(streamId);

    try {
      await mkdir(dir, { recursive: true });

      const proc = this.#spawn('ffmpeg', [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+append_list',
        playlistPath
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      entry.proc = proc;

      proc.stderr.on('data', (chunk) => {
        this.#logger.debug?.('hls.ffmpeg.stderr', { streamId, message: chunk.toString().trim() });
      });

      proc.on('exit', (code, signal) => {
        this.#logger.debug?.('hls.ffmpeg.exit', { streamId, code, signal });
        this.#cleanup(streamId);
      });

      await this.#waitForPlaylist(playlistPath, PLAYLIST_TIMEOUT_MS);
      resolveReady();
    } catch (err) {
      rejectReady(err);
      this.stop(streamId);
      throw err;
    }

    return dir;
  }

  /**
   * Reset the inactivity timer for a stream (keeps it alive).
   * @param {string} streamId
   */
  touch(streamId) {
    if (this.#streams.has(streamId)) {
      this.#resetTimer(streamId);
    }
  }

  /**
   * Stop a specific stream — kills ffmpeg and removes temp files.
   * @param {string} streamId
   */
  stop(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;

    clearTimeout(entry.timer);

    if (entry.proc && !entry.proc.killed) {
      entry.proc.kill('SIGTERM');
    }

    this.#cleanupFiles(entry.dir);
    this.#streams.delete(streamId);
    this.#logger.debug?.('hls.stream.stopped', { streamId });
  }

  /**
   * Stop all active streams.
   */
  stopAll() {
    for (const streamId of [...this.#streams.keys()]) {
      this.stop(streamId);
    }
  }

  /**
   * Check whether a stream is currently active.
   * @param {string} streamId
   * @returns {boolean}
   */
  isActive(streamId) {
    return this.#streams.has(streamId);
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Reset (or set) the inactivity timeout for a stream.
   * @param {string} streamId
   */
  #resetTimer(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(() => {
      this.#logger.debug?.('hls.stream.timeout', { streamId });
      this.stop(streamId);
    }, INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Poll until the .m3u8 playlist file exists on disk.
   * @param {string} filePath
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  async #waitForPlaylist(filePath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await access(filePath);
        return;
      } catch {
        // File doesn't exist yet — wait and retry
      }
      await new Promise((r) => setTimeout(r, PLAYLIST_POLL_MS));
    }

    throw new Error(`HLS playlist did not appear within ${timeoutMs}ms: ${filePath}`);
  }

  /**
   * Remove the entry from the map (called by proc exit handler).
   * @param {string} streamId
   */
  #cleanup(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.#cleanupFiles(entry.dir);
    this.#streams.delete(streamId);
  }

  /**
   * Remove the temp directory for a stream (best-effort, non-blocking).
   * @param {string} dir
   */
  #cleanupFiles(dir) {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
