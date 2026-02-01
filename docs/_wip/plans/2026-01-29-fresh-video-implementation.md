# Fresh Video Abstraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor YouTubeDownloadService to proper DDD layers, moving yt-dlp specifics to adapter layer.

**Architecture:** Application layer (`FreshVideoService`) handles orchestration, retention, locking. Adapter layer (`YtDlpAdapter`) handles yt-dlp commands, URL construction, format selection. Port interface defines the contract.

**Tech Stack:** Node.js ES modules, yt-dlp CLI, ffprobe

**Design Doc:** `docs/plans/2026-01-29-fresh-video-abstraction-design.md`

---

## Task 1: Create Port Interface

**Files:**
- Create: `backend/src/3_applications/media/ports/IVideoSourceGateway.mjs`

**Step 1: Create ports directory**

```bash
mkdir -p backend/src/3_applications/media/ports
```

**Step 2: Write the port interface**

```javascript
// backend/src/3_applications/media/ports/IVideoSourceGateway.mjs

/**
 * Abstract interface for downloading videos from external sources.
 *
 * Implementations: YtDlpAdapter (YouTube, Vimeo, etc.)
 *
 * @module applications/media/ports/IVideoSourceGateway
 */

/**
 * @typedef {Object} VideoSource
 * @property {string} provider - Content provider identifier (cnn, bbc)
 * @property {string} src - Platform (youtube, vimeo)
 * @property {string} type - Source type (channel, playlist)
 * @property {string} id - Platform-specific identifier
 */

/**
 * @typedef {Object} DownloadOptions
 * @property {string} outputDir - Directory to save video
 * @property {number} [maxHeight=720] - Maximum video height
 * @property {string} [preferredLang='en'] - Preferred audio language
 * @property {number} [timeoutMs=300000] - Download timeout
 */

/**
 * @typedef {Object} DownloadResult
 * @property {boolean} success
 * @property {string} [filePath] - Path to downloaded file (if success)
 * @property {string} [uploadDate] - Video upload date YYYYMMDD (if available)
 * @property {string} [error] - Error message (if failed)
 */

/**
 * Video source gateway interface shape
 */
export const IVideoSourceGateway = {
  /**
   * Download the latest video from a source
   * @param {VideoSource} source - Source configuration
   * @param {DownloadOptions} options - Download options
   * @returns {Promise<DownloadResult>}
   */
  async downloadLatest(source, options) {},
};

/**
 * Type guard for VideoSourceGateway
 * @param {Object} obj
 * @returns {boolean}
 */
export function isVideoSourceGateway(obj) {
  return obj && typeof obj.downloadLatest === 'function';
}
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/media/ports/IVideoSourceGateway.mjs
git commit -m "feat(media): add IVideoSourceGateway port interface"
```

---

## Task 2: Create YtDlpAdapter

**Files:**
- Create: `backend/src/2_adapters/media/YtDlpAdapter.mjs`
- Create: `backend/src/2_adapters/media/index.mjs`

**Step 1: Create media adapter directory**

```bash
mkdir -p backend/src/2_adapters/media
```

**Step 2: Write YtDlpAdapter**

```javascript
// backend/src/2_adapters/media/YtDlpAdapter.mjs

/**
 * YtDlpAdapter - Downloads videos using yt-dlp CLI
 *
 * Implements IVideoSourceGateway for YouTube, Vimeo, and other yt-dlp supported platforms.
 *
 * @module adapters/media/YtDlpAdapter
 */

import child_process from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Video download adapter using yt-dlp
 */
export class YtDlpAdapter {
  #logger;

  /**
   * @param {Object} config
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ logger } = {}) {
    this.#logger = logger || console;
  }

  /**
   * Download the latest video from a source
   * @param {Object} source - Source configuration
   * @param {string} source.provider - Content provider identifier
   * @param {string} source.src - Platform (youtube, vimeo)
   * @param {string} source.type - Source type (channel, playlist)
   * @param {string} source.id - Platform-specific identifier
   * @param {Object} options - Download options
   * @param {string} options.outputDir - Directory to save video
   * @param {number} [options.maxHeight=720] - Maximum video height
   * @param {string} [options.preferredLang='en'] - Preferred audio language
   * @param {number} [options.timeoutMs=300000] - Download timeout
   * @returns {Promise<{success: boolean, filePath?: string, uploadDate?: string, error?: string}>}
   */
  async downloadLatest(source, options) {
    const { provider } = source;
    const { outputDir, maxHeight = 720, preferredLang = 'en', timeoutMs = 300000 } = options;

    const url = this.#buildUrl(source);
    const formatAttempts = [
      this.#buildFormatArgs(maxHeight, 'hevc'),
      this.#buildFormatArgs(maxHeight, 'avc'),
      this.#buildFormatArgs(maxHeight, 'any'),
    ];

    for (let attempt = 0; attempt < formatAttempts.length; attempt++) {
      const formatArgs = formatAttempts[attempt];
      const outputTemplate = `${outputDir}/%(upload_date)s.%(ext)s`;

      const cmd = [
        'yt-dlp',
        '--js-runtimes node:auto',
        this.#buildExtractorArgs(source, preferredLang),
        formatArgs,
        '--remux-video mp4',
        `-o "${outputTemplate}"`,
        '--max-downloads 1',
        '--playlist-end 1',
        `"${url}"`,
      ].join(' ');

      this.#logger.info?.('ytdlp.attempt', { provider, attempt: attempt + 1 });

      try {
        await this.#execWithTimeout(cmd, timeoutMs);
        const filePath = this.#findDownloadedFile(outputDir);

        if (filePath && await this.#verifyCodec(filePath)) {
          const uploadDate = path.basename(filePath).split('.')[0];
          return { success: true, filePath, uploadDate };
        }
      } catch (e) {
        this.#logger.warn?.('ytdlp.attemptFailed', { provider, attempt: attempt + 1, error: e.message });
      }
    }

    return { success: false, error: 'All download attempts failed' };
  }

  /**
   * Build URL from source config
   * @param {Object} source
   * @returns {string}
   */
  #buildUrl(source) {
    const { src, type, id } = source;

    if (src === 'youtube') {
      return type === 'channel'
        ? `https://www.youtube.com/channel/${id}`
        : `https://www.youtube.com/playlist?list=${id}`;
    }

    if (src === 'vimeo') {
      return `https://vimeo.com/${id}`;
    }

    // Generic URL fallback (id is the full URL)
    return id;
  }

  /**
   * Build extractor-specific arguments
   * @param {Object} source
   * @param {string} lang
   * @returns {string}
   */
  #buildExtractorArgs(source, lang) {
    if (source.src === 'youtube') {
      return `--extractor-args "youtube:lang=${lang}"`;
    }
    return '';
  }

  /**
   * Build format selection arguments
   * @param {number} maxHeight
   * @param {string} codec - 'hevc', 'avc', or 'any'
   * @returns {string}
   */
  #buildFormatArgs(maxHeight, codec) {
    if (codec === 'hevc') {
      return `-f 'bestvideo[vcodec^=hevc][height<=${maxHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${maxHeight}]+bestaudio[ext=m4a]/best[height<=${maxHeight}]'`;
    }
    if (codec === 'avc') {
      return `-f 'bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]'`;
    }
    return `-f 'best[height<=${Math.round(maxHeight * 1.5)}]'`;
  }

  /**
   * Execute command with timeout
   * @param {string} cmd
   * @param {number} timeoutMs
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  #execWithTimeout(cmd, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = child_process.exec(`exec ${cmd}`, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve({ stdout, stderr });
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('exit', () => clearTimeout(timer));
    });
  }

  /**
   * Find most recently downloaded file in directory
   * @param {string} dir
   * @returns {string|null}
   */
  #findDownloadedFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
    if (files.length === 0) return null;
    return path.join(dir, files.sort().pop());
  }

  /**
   * Verify video has valid codec using ffprobe
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async #verifyCodec(filePath) {
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        child_process.exec(
          `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`,
          (error, stdout, stderr) => {
            if (error) return reject(error);
            resolve({ stdout, stderr });
          }
        );
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

export default YtDlpAdapter;
```

**Step 3: Write index.mjs**

```javascript
// backend/src/2_adapters/media/index.mjs

export { YtDlpAdapter } from './YtDlpAdapter.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/2_adapters/media/
git commit -m "feat(adapters): add YtDlpAdapter for video downloads"
```

---

## Task 3: Create FreshVideoService

**Files:**
- Create: `backend/src/3_applications/media/services/FreshVideoService.mjs`
- Reference: `backend/src/3_applications/media/services/YouTubeDownloadService.mjs` (copy retention logic)

**Step 1: Write FreshVideoService**

Copy the orchestration logic from YouTubeDownloadService but remove all yt-dlp specifics:

```javascript
// backend/src/3_applications/media/services/FreshVideoService.mjs

/**
 * FreshVideoService - Orchestrates fresh video downloads from configured sources
 *
 * Handles scheduling coordination, retention policy, file locking.
 * Delegates actual downloads to injected videoSourceGateway.
 *
 * @module applications/media/services/FreshVideoService
 */

import { nowTs24 } from '#system/utils/index.mjs';
import fs from 'fs';
import path from 'path';

/**
 * Fresh video download service for scheduled content
 */
export class FreshVideoService {
  #videoSourceGateway;
  #configLoader;
  #mediaPath;
  #logger;
  #options;

  /**
   * @param {Object} config
   * @param {Object} config.videoSourceGateway - Gateway implementing IVideoSourceGateway
   * @param {Function} config.configLoader - Function to load source config
   * @param {string} config.mediaPath - Base path for video storage
   * @param {Object} [config.logger] - Logger instance
   * @param {Object} [config.options] - Service options
   */
  constructor({ videoSourceGateway, configLoader, mediaPath, logger, options = {} }) {
    if (!videoSourceGateway) throw new Error('FreshVideoService requires videoSourceGateway');
    if (!configLoader) throw new Error('FreshVideoService requires configLoader');
    if (!mediaPath) throw new Error('FreshVideoService requires mediaPath');

    this.#videoSourceGateway = videoSourceGateway;
    this.#configLoader = configLoader;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      processTimeout: 300000,
      retryDelay: 5000,
      audioLang: 'en',
      lockStaleMs: 60 * 60 * 1000,
      ...options
    };

    this.#ensureDir(this.#mediaPath);
  }

  #ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  #formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  #getCutoffDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.#options.daysToKeep);
    return this.#formatDate(date);
  }

  /**
   * Acquire file lock to prevent concurrent runs
   * @returns {Function|null} Release function or null if lock held
   */
  #acquireLock() {
    const lockFile = path.join(this.#mediaPath, 'freshvideo.lock');

    try {
      if (fs.existsSync(lockFile)) {
        const stat = fs.statSync(lockFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > this.#options.lockStaleMs) {
          this.#logger.warn?.('freshvideo.staleLock', { ageMins: Math.round(ageMs / 60000) });
          fs.unlinkSync(lockFile);
        }
      }

      const fd = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: nowTs24() }));
      fs.closeSync(fd);

      return () => {
        try { fs.unlinkSync(lockFile); } catch (_) {}
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Remove files older than retention period
   * @returns {string[]} Paths of deleted files
   */
  #cleanupOldFiles() {
    const deleted = [];
    const cutoff = this.#getCutoffDate();

    if (!fs.existsSync(this.#mediaPath)) return deleted;

    for (const folder of fs.readdirSync(this.#mediaPath)) {
      const folderPath = path.join(this.#mediaPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      for (const file of fs.readdirSync(folderPath)) {
        const datePart = file.split('.')[0];
        if (datePart < cutoff) {
          const filePath = path.join(folderPath, file);
          try {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
            this.#logger.info?.('freshvideo.deletedOld', { path: filePath });
          } catch (e) {
            this.#logger.warn?.('freshvideo.deleteError', { path: filePath, error: e.message });
          }
        }
      }
    }

    return deleted;
  }

  /**
   * Remove invalid/partial files from a directory
   * @param {string} dirPath
   * @returns {number}
   */
  #cleanupInvalidFiles(dirPath) {
    const validPattern = /^\d{8}\.mp4$/;
    let count = 0;

    if (!fs.existsSync(dirPath)) return 0;

    for (const file of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, file);
      try {
        if (fs.statSync(filePath).isFile() && !validPattern.test(file)) {
          fs.unlinkSync(filePath);
          count++;
          this.#logger.debug?.('freshvideo.removedInvalid', { path: filePath });
        }
      } catch (_) {}
    }

    return count;
  }

  /**
   * Download latest video for a source
   * @param {Object} source
   * @returns {Promise<Object>}
   */
  async #downloadSource(source) {
    const outputDir = path.join(this.#mediaPath, source.provider);
    this.#ensureDir(outputDir);

    const todayFile = path.join(outputDir, `${this.#formatDate()}.mp4`);
    if (fs.existsSync(todayFile)) {
      this.#logger.info?.('freshvideo.alreadyExists', { provider: source.provider });
      return { provider: source.provider, success: true, skipped: true };
    }

    this.#logger.info?.('freshvideo.downloading', { provider: source.provider });

    const result = await this.#videoSourceGateway.downloadLatest(source, {
      outputDir,
      maxHeight: 720,
      preferredLang: this.#options.audioLang,
      timeoutMs: this.#options.processTimeout,
    });

    if (result.success) {
      this.#logger.info?.('freshvideo.downloaded', { provider: source.provider, filePath: result.filePath });
    } else {
      this.#logger.error?.('freshvideo.failed', { provider: source.provider, error: result.error });
    }

    this.#cleanupInvalidFiles(outputDir);
    return { provider: source.provider, ...result };
  }

  /**
   * Get list of all valid video files
   * @returns {string[]}
   */
  #getValidFiles() {
    const files = [];
    const cutoff = this.#getCutoffDate();

    if (!fs.existsSync(this.#mediaPath)) return files;

    for (const folder of fs.readdirSync(this.#mediaPath)) {
      const folderPath = path.join(this.#mediaPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      for (const file of fs.readdirSync(folderPath)) {
        if (file.endsWith('.mp4')) {
          const datePart = file.split('.')[0];
          if (datePart >= cutoff) {
            files.push(path.join(folderPath, file));
          }
        }
      }
    }

    return files;
  }

  /**
   * Run the download job
   * @returns {Promise<Object>}
   */
  async run() {
    const releaseLock = this.#acquireLock();
    if (!releaseLock) {
      this.#logger.warn?.('freshvideo.lockHeld', { message: 'Another instance is running' });
      return { skipped: true, reason: 'lock_held', deleted: [], sources: [], files: [] };
    }

    try {
      const sources = await this.#configLoader();
      if (!Array.isArray(sources) || sources.length === 0) {
        this.#logger.warn?.('freshvideo.noConfig', { message: 'No sources configured' });
        return { skipped: true, reason: 'no_config', deleted: [], sources: [], files: [] };
      }

      const deleted = this.#cleanupOldFiles();
      this.#cleanupInvalidFiles(this.#mediaPath);

      const results = [];
      for (const source of sources) {
        const result = await this.#downloadSource(source);
        results.push(result);
      }

      const files = this.#getValidFiles();

      return {
        skipped: false,
        deleted,
        sources: sources.map(s => s.provider),
        files,
        results
      };
    } finally {
      releaseLock();
    }
  }
}

export default FreshVideoService;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/media/services/FreshVideoService.mjs
git commit -m "feat(media): add FreshVideoService with gateway injection"
```

---

## Task 4: Update Job Handler

**Files:**
- Modify: `backend/src/3_applications/media/YouTubeJobHandler.mjs`

**Step 1: Update to use FreshVideoService and accept gateway**

```javascript
// backend/src/3_applications/media/YouTubeJobHandler.mjs

/**
 * FreshVideoJobHandler - Scheduler-compatible handler for fresh video downloads
 *
 * Wraps FreshVideoService for scheduler integration.
 *
 * @module applications/media/YouTubeJobHandler
 */

import { FreshVideoService } from './services/FreshVideoService.mjs';

/**
 * Create a scheduler-compatible handler for fresh video downloads
 *
 * @param {Object} config
 * @param {Object} config.videoSourceGateway - Gateway implementing IVideoSourceGateway
 * @param {Function} config.loadFile - Function to load YAML config files
 * @param {string} config.mediaPath - Path to media/video/news directory
 * @param {Object} [config.logger] - Logger instance
 * @returns {Function} Async handler (logger, executionId) => Promise<void>
 */
export function createFreshVideoJobHandler({ videoSourceGateway, loadFile, mediaPath, logger }) {
  const service = new FreshVideoService({
    videoSourceGateway,
    configLoader: () => loadFile('state/youtube'),
    mediaPath,
    logger,
  });

  return async (scopedLogger, executionId) => {
    const log = scopedLogger || logger || console;

    log.info?.('freshvideo.job.start', { executionId });

    try {
      const result = await service.run();

      if (result.skipped) {
        log.info?.('freshvideo.job.skipped', { executionId, reason: result.reason });
      } else {
        log.info?.('freshvideo.job.complete', {
          executionId,
          deleted: result.deleted.length,
          sources: result.sources.length,
          files: result.files.length,
        });
      }

      return result;
    } catch (error) {
      log.error?.('freshvideo.job.error', { executionId, error: error.message });
      throw error;
    }
  };
}

// Keep old export name for backward compatibility during transition
export const createYouTubeJobHandler = createFreshVideoJobHandler;

export default createFreshVideoJobHandler;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/media/YouTubeJobHandler.mjs
git commit -m "refactor(media): update job handler to use FreshVideoService"
```

---

## Task 5: Update Bootstrap Wiring

**Files:**
- Modify: `backend/src/app.mjs` (lines ~100-102, ~940-944)

**Step 1: Add YtDlpAdapter import**

At line ~100 (after the Media jobs comment), change:

```javascript
// Media jobs (YouTube downloads, etc.)
import { createYouTubeJobHandler } from './3_applications/media/YouTubeJobHandler.mjs';
```

To:

```javascript
// Media jobs (fresh video downloads)
import { createFreshVideoJobHandler } from './3_applications/media/YouTubeJobHandler.mjs';
import { YtDlpAdapter } from './2_adapters/media/YtDlpAdapter.mjs';
```

**Step 2: Update handler registration**

At lines ~935-944, change:

```javascript
  // Register YouTube download handler
  const mediaPath = mediaBasePath
    ? join(mediaBasePath, 'video', 'news')
    : join(__dirname, '..', 'media', 'video', 'news');

  mediaExecutor.register('youtube', createYouTubeJobHandler({
    loadFile,
    mediaPath,
    logger: rootLogger.child({ module: 'youtube' })
  }));
```

To:

```javascript
  // Register fresh video download handler
  const mediaPath = mediaBasePath
    ? join(mediaBasePath, 'video', 'news')
    : join(__dirname, '..', 'media', 'video', 'news');

  const videoSourceGateway = new YtDlpAdapter({
    logger: rootLogger.child({ module: 'ytdlp' })
  });

  mediaExecutor.register('youtube', createFreshVideoJobHandler({
    videoSourceGateway,
    loadFile,
    mediaPath,
    logger: rootLogger.child({ module: 'freshvideo' })
  }));
```

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(bootstrap): wire YtDlpAdapter into fresh video handler"
```

---

## Task 6: Update Exports

**Files:**
- Modify: `backend/src/3_applications/media/index.mjs`

**Step 1: Update exports**

```javascript
// backend/src/3_applications/media/index.mjs

export { createFreshVideoJobHandler, createYouTubeJobHandler } from './YouTubeJobHandler.mjs';
export { FreshVideoService } from './services/FreshVideoService.mjs';
export { MediaJobExecutor } from './MediaJobExecutor.mjs';
export { IVideoSourceGateway, isVideoSourceGateway } from './ports/IVideoSourceGateway.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/media/index.mjs
git commit -m "refactor(media): update exports for new abstractions"
```

---

## Task 7: Delete Old Service

**Files:**
- Delete: `backend/src/3_applications/media/services/YouTubeDownloadService.mjs`

**Step 1: Remove old file**

```bash
git rm backend/src/3_applications/media/services/YouTubeDownloadService.mjs
```

**Step 2: Commit**

```bash
git commit -m "refactor(media): remove old YouTubeDownloadService"
```

---

## Task 8: Verify and Test

**Step 1: Run tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Manual verification (optional)**

Start dev server and trigger a scheduled job, or run the handler directly to verify downloads work.

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(media): address test/lint issues from refactor"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `ports/IVideoSourceGateway.mjs` | Port interface |
| 2 | `2_adapters/media/YtDlpAdapter.mjs` | Adapter implementation |
| 3 | `services/FreshVideoService.mjs` | Application service |
| 4 | `YouTubeJobHandler.mjs` | Update job handler |
| 5 | `app.mjs` | Wire adapter in bootstrap |
| 6 | `index.mjs` | Update exports |
| 7 | Delete `YouTubeDownloadService.mjs` | Remove old code |
| 8 | Tests | Verify everything works |
