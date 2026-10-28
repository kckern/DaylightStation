import path from 'node:path';
import {
  ensureDir, fileExists, listFiles, getFileStats, deleteFile, renameFile, setFileTimes,
} from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { ICameraClipLibrary } from '../application/ports/ICameraClipLibrary.mjs';
import { toClip } from '../domain/selection.mjs';

/** A camera recording path as the recorder names it; anything else is refused. */
const CLIP_NAME_RE = /^(\/mnt\/sd[a-z]*\/)?Mp4Record\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_.-]+\.mp4$/;
const SEARCH_TTL_MS = 2 * 60 * 1000;
const STALE_PART_MS = 60 * 60 * 1000;

/**
 * Camera clip library: the day's clips from the detection ledger, else a live
 * camera search; clip bytes fetched once from the camera into a bounded cache.
 */
export class CameraClipLibrary extends ICameraClipLibrary {
  #ledgerStore; #openSource; #cacheDir; #maxCached; #logger; #now;
  #searchCache = new Map();
  #inflight = new Map();

  constructor({ ledgerStore, openSource, cacheDir = '/tmp/camera-clips', maxCached = 40, logger = console, now = () => Date.now() } = {}) {
    super();
    if (!ledgerStore?.read) throw new TypeError('CameraClipLibrary requires ledgerStore.read');
    if (typeof openSource !== 'function') throw new TypeError('CameraClipLibrary requires openSource');
    this.#ledgerStore = ledgerStore;
    this.#openSource = openSource;
    this.#cacheDir = cacheDir;
    this.#maxCached = maxCached;
    this.#logger = logger;
    this.#now = now;
  }

  /** Entries held in the search cache (diagnostics and tests). */
  get searchCacheSize() { return this.#searchCache.size; }

  async listClips({ cameraId, day }) {
    let records = [];
    try {
      records = this.#ledgerStore.read({ camera: cameraId, day }) || [];
    } catch (error) {
      // A torn final line (ledger job mid-append) must not 500 the listing.
      this.#logger.warn?.('camera.clips.ledger_unreadable', { camera: cameraId, day, error: error.message });
    }
    const fromLedger = records
      .filter((record) => record?.clip?.name)
      .map((record) => ({
        start: record.ts,
        end: record.endTs,
        name: record.clip.name,
        labels: Array.isArray(record.labels) ? record.labels : [],
      }));
    if (fromLedger.length) {
      const clips = sortByStart(fromLedger);
      this.#logger.debug?.('camera.clips.listed', { camera: cameraId, day, source: 'ledger', count: clips.length });
      return clips;
    }
    const clips = await this.#searchCamera(cameraId, day);
    this.#logger.debug?.('camera.clips.listed', { camera: cameraId, day, source: 'camera', count: clips.length });
    return clips;
  }

  async #searchCamera(cameraId, day) {
    const key = `${cameraId}|${day}`;
    const cached = this.#searchCache.get(key);
    if (cached) {
      if (this.#now() - cached.at < SEARCH_TTL_MS) return cached.clips;
      this.#searchCache.delete(key);
    }
    try {
      const source = this.#openSource(cameraId);
      if (!source) return [];
      const raw = await source.search(day);
      const clips = sortByStart((raw || [])
        .map((record) => toClip(record, { date: day }))
        .filter((clip) => clip.name)
        .map((clip) => ({ start: clip.start.toISOString(), end: clip.end.toISOString(), name: clip.name, labels: [] })));
      const at = this.#now();
      for (const [k, v] of this.#searchCache) if (at - v.at >= SEARCH_TTL_MS) this.#searchCache.delete(k);
      this.#searchCache.set(key, { at, clips });
      return clips;
    } catch (error) {
      this.#logger.warn?.('camera.clips.search_failed', { camera: cameraId, day, error: error.message });
      return [];
    }
  }

  async openClip({ cameraId, name }) {
    if (typeof name !== 'string' || !CLIP_NAME_RE.test(name)) {
      throw new ValidationError('clip name is not a camera recording', { code: 'INVALID_CLIP_NAME', field: 'name', value: name });
    }
    if (typeof cameraId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cameraId)) {
      throw new ValidationError('invalid camera id', { code: 'INVALID_CAMERA_ID', field: 'cameraId', value: cameraId });
    }
    const dir = path.join(this.#cacheDir, cameraId);
    const filePath = path.join(dir, path.basename(name));
    if (!fileExists(filePath)) {
      // One download per file at a time: a second viewer waits on the first.
      let pending = this.#inflight.get(filePath);
      if (!pending) {
        pending = this.#fetchInto({ cameraId, name, dir, filePath })
          .finally(() => this.#inflight.delete(filePath));
        this.#inflight.set(filePath, pending);
      }
      await pending;
    } else {
      // Touch on use so pruning keeps what is being watched (LRU, not FIFO).
      try { const now = new Date(); setFileTimes(filePath, now, now); } catch { /* best effort */ }
    }
    return createLocalFileResource(filePath, { mimeType: 'video/mp4' });
  }

  async #fetchInto({ cameraId, name, dir, filePath }) {
    const source = this.#openSource(cameraId);
    if (!source) throw new Error(`camera source unavailable: ${cameraId}`);
    ensureDir(dir);
    // Download to a side file so an interrupted fetch is never served as a clip.
    const partPath = `${filePath}.part`;
    try {
      const bytes = await source.fetch({ clip: { name }, destPath: partPath });
      renameFile(partPath, filePath);
      this.#logger.info?.('camera.clips.fetched', { camera: cameraId, name, bytes });
    } catch (error) {
      deleteFile(partPath);
      throw error;
    }
    this.#prune(dir);
  }

  #prune(dir) {
    const nowMs = this.#now();
    for (const file of listFiles(dir)) {
      if (!file.endsWith('.part')) continue;
      const full = path.join(dir, file);
      if (this.#inflight.has(full.slice(0, -'.part'.length))) continue;
      try {
        if (nowMs - getFileStats(full).mtimeMs > STALE_PART_MS) deleteFile(full);
      } catch { /* vanished */ }
    }
    const files = listFiles(dir)
      .filter((file) => file.endsWith('.mp4'))
      .map((file) => {
        const full = path.join(dir, file);
        try { return { full, mtime: getFileStats(full).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    for (const { full } of files.slice(this.#maxCached)) deleteFile(full);
  }
}

function sortByStart(clips) {
  return [...clips].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export default CameraClipLibrary;
