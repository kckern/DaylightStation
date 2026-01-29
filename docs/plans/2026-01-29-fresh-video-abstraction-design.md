# Fresh Video Abstraction Design

> Refactor YouTubeDownloadService to proper DDD layers, separating application orchestration from adapter implementation.

## Problem

`YouTubeDownloadService` in `3_applications/` violates application layer guidelines:
- Vendor name in class name
- Direct fs/path imports
- yt-dlp command construction
- YouTube URL hardcoding
- Format/codec-specific logic

## Solution

Split into application layer (orchestration) and adapter layer (yt-dlp specifics).

---

## Architecture

### File Structure

**Application Layer** (`3_applications/media/`)
```
3_applications/media/
├── ports/
│   └── IVideoSourceGateway.mjs
├── services/
│   └── FreshVideoService.mjs
├── YouTubeJobHandler.mjs
└── index.mjs
```

**Adapter Layer** (`2_adapters/media/`)
```
2_adapters/media/
└── YtDlpAdapter.mjs
```

### Responsibility Split

| Concern | Layer | File |
|---------|-------|------|
| yt-dlp commands | Adapter | YtDlpAdapter |
| URL construction | Adapter | YtDlpAdapter |
| Format/codec selection | Adapter | YtDlpAdapter |
| Retention/cleanup | Application | FreshVideoService |
| File locking | Application | FreshVideoService |
| Directory management | Application | FreshVideoService |
| Job orchestration | Application | FreshVideoService |

---

## Port Interface

```javascript
// 3_applications/media/ports/IVideoSourceGateway.mjs

/**
 * Abstract interface for downloading videos from external sources.
 * Implementations: YtDlpAdapter (YouTube, Vimeo, etc.)
 */
export const IVideoSourceGateway = {
  /**
   * Download the latest video from a source
   * @param {Object} source - Source configuration
   * @param {string} source.provider - Content provider identifier (cnn, bbc)
   * @param {string} source.src - Platform (youtube, vimeo)
   * @param {string} source.type - Source type (channel, playlist)
   * @param {string} source.id - Platform-specific identifier
   * @param {Object} options - Download options
   * @param {string} options.outputDir - Directory to save video
   * @param {number} [options.maxHeight=720] - Maximum video height
   * @param {string} [options.preferredLang='en'] - Preferred audio language
   * @param {number} [options.timeoutMs=300000] - Download timeout
   * @returns {Promise<DownloadResult>}
   */
  async downloadLatest(source, options) {},
};

/**
 * @typedef {Object} DownloadResult
 * @property {boolean} success
 * @property {string} [filePath] - Path to downloaded file (if success)
 * @property {string} [uploadDate] - Video upload date YYYYMMDD (if available)
 * @property {string} [error] - Error message (if failed)
 */

export function isVideoSourceGateway(obj) {
  return obj && typeof obj.downloadLatest === 'function';
}
```

---

## Application Layer: FreshVideoService

```javascript
// 3_applications/media/services/FreshVideoService.mjs

export class FreshVideoService {
  #videoSourceGateway;
  #configLoader;
  #mediaPath;
  #logger;
  #options;

  constructor({ videoSourceGateway, configLoader, mediaPath, logger, options = {} }) {
    if (!videoSourceGateway) throw new Error('videoSourceGateway is required');
    if (!configLoader) throw new Error('configLoader is required');
    if (!mediaPath) throw new Error('mediaPath is required');

    this.#videoSourceGateway = videoSourceGateway;
    this.#configLoader = configLoader;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      retryDelay: 5000,
      audioLang: 'en',
      maxAttempts: 3,
      lockStaleMs: 60 * 60 * 1000,
      ...options
    };
  }

  async run() {
    const releaseLock = this.#acquireLock();
    if (!releaseLock) {
      return { skipped: true, reason: 'lock_held', deleted: [], sources: [], files: [] };
    }

    try {
      const sources = await this.#configLoader();
      if (!Array.isArray(sources) || sources.length === 0) {
        return { skipped: true, reason: 'no_config', deleted: [], sources: [], files: [] };
      }

      const deleted = this.#cleanupOldFiles();
      const results = [];

      for (const source of sources) {
        const result = await this.#downloadSource(source);
        results.push(result);
      }

      return {
        skipped: false,
        deleted,
        sources: sources.map(s => s.provider),
        files: this.#getValidFiles(),
        results
      };
    } finally {
      releaseLock();
    }
  }

  async #downloadSource(source) {
    const outputDir = path.join(this.#mediaPath, source.provider);
    this.#ensureDir(outputDir);

    // Check if already downloaded today
    const todayFile = path.join(outputDir, `${this.#formatDate()}.mp4`);
    if (fs.existsSync(todayFile)) {
      this.#logger.info?.('freshvideo.alreadyExists', { provider: source.provider });
      return { provider: source.provider, success: true, skipped: true };
    }

    // Delegate to gateway
    const result = await this.#videoSourceGateway.downloadLatest(source, {
      outputDir,
      maxHeight: 720,
      preferredLang: this.#options.audioLang,
      timeoutMs: this.#options.processTimeout,
    });

    if (result.success) {
      this.#logger.info?.('freshvideo.downloaded', { provider: source.provider });
    } else {
      this.#logger.error?.('freshvideo.failed', { provider: source.provider, error: result.error });
    }

    return { provider: source.provider, ...result };
  }

  // Retention, locking, cleanup, directory methods (moved from YouTubeDownloadService)
  #acquireLock() { /* ... */ }
  #cleanupOldFiles() { /* ... */ }
  #getValidFiles() { /* ... */ }
  #ensureDir(dirPath) { /* ... */ }
  #formatDate(date = new Date()) { /* ... */ }
  #getCutoffDate() { /* ... */ }
}
```

---

## Adapter Layer: YtDlpAdapter

```javascript
// 2_adapters/media/YtDlpAdapter.mjs

import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const exec = promisify(child_process.exec);

export class YtDlpAdapter {
  #logger;

  constructor({ logger } = {}) {
    this.#logger = logger || console;
  }

  async downloadLatest(source, options) {
    const { provider } = source;
    const { outputDir, maxHeight = 720, preferredLang = 'en', timeoutMs = 300000 } = options;

    const url = this.#buildUrl(source);
    const attempts = [
      this.#buildFormatArgs(maxHeight, 'hevc'),
      this.#buildFormatArgs(maxHeight, 'avc'),
      this.#buildFormatArgs(maxHeight, 'any'),
    ];

    for (let i = 0; i < attempts.length; i++) {
      const formatArgs = attempts[i];
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

      this.#logger.info?.('ytdlp.attempt', { provider, attempt: i + 1 });

      try {
        await this.#execWithTimeout(cmd, timeoutMs);
        const filePath = this.#findDownloadedFile(outputDir);

        if (filePath && this.#verifyCodec(filePath)) {
          const uploadDate = path.basename(filePath).split('.')[0];
          return { success: true, filePath, uploadDate };
        }
      } catch (e) {
        this.#logger.warn?.('ytdlp.attemptFailed', { provider, attempt: i + 1, error: e.message });
      }
    }

    return { success: false, error: 'All download attempts failed' };
  }

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

    // Generic URL fallback
    return id;
  }

  #buildExtractorArgs(source, lang) {
    if (source.src === 'youtube') {
      return `--extractor-args "youtube:lang=${lang}"`;
    }
    return '';
  }

  #buildFormatArgs(maxHeight, codec) {
    if (codec === 'hevc') {
      return `-f 'bestvideo[vcodec^=hevc][height<=${maxHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${maxHeight}]+bestaudio[ext=m4a]/best[height<=${maxHeight}]'`;
    }
    if (codec === 'avc') {
      return `-f 'bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]'`;
    }
    return `-f 'best[height<=${maxHeight * 1.5}]'`;
  }

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

  #findDownloadedFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
    if (files.length === 0) return null;
    // Return most recent
    return path.join(dir, files.sort().pop());
  }

  #verifyCodec(filePath) {
    try {
      const { stdout } = child_process.execSync(
        `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`
      );
      return stdout.toString().trim().length > 0;
    } catch {
      return false;
    }
  }
}
```

---

## Config Format

**File:** `state/youtube.yml` (or rename to `state/fresh-video.yml`)

```yaml
- provider: cnn
  src: youtube
  type: channel
  id: UCTOoRgpHTjAQPk6Ak70u-pA

- provider: bbc
  src: youtube
  type: playlist
  id: PLOixzgWxGZAkY5ZBr1IQwLEa2BHVnzAxa

- provider: world_az
  src: youtube
  type: channel
  id: UCVRaEwN-NRazng2d1-TKzQQ

- provider: fox13
  src: youtube
  type: channel
  id: UC5bKZHg4PzURMOWcvanl6nA
```

---

## Wiring

**Job Handler:**
```javascript
// 3_applications/media/YouTubeJobHandler.mjs

import { FreshVideoService } from './services/FreshVideoService.mjs';

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
```

**Bootstrap (scheduler setup):**
```javascript
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';
import { createFreshVideoJobHandler } from '#applications/media/YouTubeJobHandler.mjs';

const videoSourceGateway = new YtDlpAdapter({ logger });

const freshVideoHandler = createFreshVideoJobHandler({
  videoSourceGateway,
  loadFile,
  mediaPath: paths.media + '/video/news',
  logger,
});

scheduler.register('youtube', freshVideoHandler);
```

---

## Implementation Tasks

1. Create `2_adapters/media/YtDlpAdapter.mjs`
2. Create `3_applications/media/ports/IVideoSourceGateway.mjs`
3. Refactor `YouTubeDownloadService.mjs` → `FreshVideoService.mjs`
4. Update `YouTubeJobHandler.mjs` to accept gateway injection
5. Update scheduler/bootstrap wiring to instantiate adapter
6. Migrate config format (add provider/src/type fields)
7. Update exports in index files

## Future Extensibility

- **Vimeo:** YtDlpAdapter already supports via `#buildUrl()`
- **RSS feeds:** New `RssVideoAdapter` implementing same interface
- **Alternative downloader:** Replace YtDlpAdapter without touching application layer
