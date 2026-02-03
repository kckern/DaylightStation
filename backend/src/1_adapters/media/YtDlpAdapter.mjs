/**
 * YtDlpAdapter - yt-dlp implementation for video downloads
 *
 * Implements IVideoSourceGateway for downloading videos from YouTube, Vimeo, etc.
 * Uses yt-dlp CLI tool with retry logic and codec verification.
 *
 * Features:
 * - Downloads single latest video from channels/playlists
 * - HEVC/AVC codec preference with fallback
 * - Timeout handling for long downloads
 * - Codec verification with ffprobe
 *
 * @module adapters/media/YtDlpAdapter
 */

import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const exec = promisify(child_process.exec);

/**
 * yt-dlp adapter for video source downloads
 */
export class YtDlpAdapter {
  #logger;

  /**
   * @param {Object} [deps] - Dependencies
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps = {}) {
    this.#logger = deps.logger || console;
  }

  /**
   * Build URL from source configuration
   * @param {Object} source - Video source
   * @param {string} source.src - Platform (youtube, vimeo)
   * @param {string} source.type - Source type (channel, playlist)
   * @param {string} source.id - Platform-specific identifier
   * @returns {string} Full URL
   */
  #buildUrl(source) {
    const { src, type, id } = source;

    if (src === 'youtube') {
      if (type === 'channel') {
        return `https://www.youtube.com/channel/${id}`;
      }
      if (type === 'playlist') {
        return `https://www.youtube.com/playlist?list=${id}`;
      }
    }

    if (src === 'vimeo') {
      return `https://vimeo.com/${id}`;
    }

    // Fallback: treat id as a direct URL
    return id;
  }

  /**
   * Build extractor arguments for language preference
   * @param {Object} source - Video source
   * @param {string} lang - Preferred language code
   * @returns {string} Extractor args string
   */
  #buildExtractorArgs(source, lang) {
    if (source.src === 'youtube') {
      return `--extractor-args "youtube:lang=${lang}"`;
    }
    return '';
  }

  /**
   * Build format selection arguments
   * @param {number} maxHeight - Maximum video height
   * @param {'hevc'|'avc'|'any'} codec - Preferred codec
   * @returns {string} Format args string
   */
  #buildFormatArgs(maxHeight, codec) {
    if (codec === 'hevc') {
      return `-f 'bestvideo[vcodec^=hevc][height<=${maxHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${maxHeight}]+bestaudio[ext=m4a]/best[height<=${maxHeight}]'`;
    }
    if (codec === 'avc') {
      return `-f 'bestvideo[vcodec^=avc][height<=${maxHeight}]+bestaudio[ext=m4a]/best[height<=${maxHeight}]'`;
    }
    // 'any' - just best available
    return `-f 'best[height<=${maxHeight * 1.5}]'`;
  }

  /**
   * Execute yt-dlp command with timeout
   * @param {string} cmd - Command to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  #execWithTimeout(cmd, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = child_process.exec(`exec ${cmd}`, (error, stdout, stderr) => {
        if (error) return reject(error);
        return resolve({ stdout, stderr });
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Process timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('exit', () => clearTimeout(timer));
    });
  }

  /**
   * Find most recently downloaded .mp4 file in directory
   * @param {string} dir - Directory to search
   * @returns {string|null} File path or null if not found
   */
  #findDownloadedFile(dir) {
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  }

  /**
   * Verify video has valid codec using ffprobe
   * @param {string} filePath - Path to video file
   * @returns {Promise<boolean>}
   */
  async #verifyCodec(filePath) {
    try {
      const { stdout } = await exec(
        `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`
      );
      return stdout.trim().length > 0;
    } catch (e) {
      this.#logger.warn?.('ytdlp.ffprobeError', { path: filePath, error: e.message });
      return false;
    }
  }

  /**
   * Extract upload date from filename (YYYYMMDD.mp4)
   * @param {string} filePath - Path to video file
   * @returns {string|null} Upload date or null
   */
  #extractUploadDate(filePath) {
    const filename = path.basename(filePath);
    const match = filename.match(/^(\d{8})\.mp4$/);
    return match ? match[1] : null;
  }

  /**
   * Clean up invalid/partial files from directory
   * @param {string} dirPath - Directory to clean
   */
  #cleanupInvalidFiles(dirPath) {
    const validPattern = /^\d{8}\.mp4$/;

    if (!fs.existsSync(dirPath)) return;

    for (const file of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, file);
      try {
        if (fs.statSync(filePath).isFile() && !validPattern.test(file)) {
          fs.unlinkSync(filePath);
          this.#logger.debug?.('ytdlp.removedInvalid', { path: filePath });
        }
      } catch (_) {}
    }
  }

  /**
   * Extract channel avatar URL from YouTube channel page HTML
   * @param {string} channelUrl - YouTube channel URL
   * @returns {Promise<string|null>} Avatar URL or null
   */
  async #fetchChannelAvatar(channelUrl) {
    if (!channelUrl) return null;

    try {
      // Use grep to extract just the avatar URL, avoiding huge buffer
      const cmd = `curl -sL "${channelUrl}" | grep -o '"avatar":{"thumbnails":\\[{"url":"[^"]*"' | head -1 | sed 's/.*"url":"\\([^"]*\\)".*/\\1/'`;
      const { stdout } = await this.#execWithTimeout(cmd, 30000);

      const avatarUrl = stdout.trim();
      if (avatarUrl && avatarUrl.startsWith('http')) {
        return avatarUrl;
      }
    } catch (e) {
      this.#logger.debug?.('ytdlp.avatarFetchError', { channelUrl, error: e.message });
    }

    return null;
  }

  /**
   * Fetch channel/playlist metadata (title, description, thumbnail)
   * @param {Object} source - Source configuration
   * @returns {Promise<{title?: string, description?: string, thumbnailUrl?: string, uploader?: string} | null>}
   */
  async fetchChannelMetadata(source) {
    const url = this.#buildUrl(source);

    // Use yt-dlp to get first video metadata (which contains playlist/channel info)
    // Note: Don't use --flat-playlist as it omits channel_url/uploader_url needed for avatar
    const cmd = [
      'yt-dlp',
      '--dump-json',
      '--playlist-items 1',  // Get just the first item to extract playlist metadata
      `"${url}"`
    ].join(' ');

    try {
      const { stdout } = await this.#execWithTimeout(cmd, 60000);
      // Parse just the first line (first video contains playlist metadata)
      const firstLine = stdout.trim().split('\n')[0];
      const data = JSON.parse(firstLine);

      // Extract playlist/channel metadata from video entry
      const title = data.playlist_title || data.channel || data.uploader || data.title || source.provider;

      // Try to get the actual channel avatar (not video thumbnail)
      // Prefer uploader_url (@handle format) as it's more reliable for avatar extraction
      let thumbnailUrl = null;
      const channelUrl = data.uploader_url || data.channel_url;
      if (channelUrl) {
        this.#logger.debug?.('ytdlp.fetchingAvatar', { provider: source.provider, channelUrl });
        thumbnailUrl = await this.#fetchChannelAvatar(channelUrl);
      }

      // Fallback to video thumbnail if channel avatar not found
      if (!thumbnailUrl && data.thumbnails?.length) {
        const sortedThumbs = [...data.thumbnails].sort((a, b) => (b.height || 0) - (a.height || 0));
        thumbnailUrl = sortedThumbs[0]?.url;
        this.#logger.debug?.('ytdlp.usingVideoThumbnail', { provider: source.provider });
      }

      return {
        title,
        description: data.description || null,
        thumbnailUrl,
        uploader: data.uploader || data.channel || data.playlist_uploader || null
      };
    } catch (e) {
      this.#logger.warn?.('ytdlp.metadataError', {
        provider: source.provider,
        error: e.message
      });
      return null;
    }
  }

  /**
   * Download a thumbnail image
   * @param {string} url - Thumbnail URL
   * @param {string} outputPath - Path to save the image (e.g., /path/to/show.jpg)
   * @returns {Promise<boolean>} Success status
   */
  async downloadThumbnail(url, outputPath) {
    if (!url) return false;

    try {
      // Use curl or wget to download the image
      const cmd = `curl -sL -o "${outputPath}" "${url}"`;
      await this.#execWithTimeout(cmd, 30000);

      // Verify file was created
      return fs.existsSync(outputPath);
    } catch (e) {
      this.#logger.warn?.('ytdlp.thumbnailError', {
        url,
        outputPath,
        error: e.message
      });
      return false;
    }
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
    const {
      outputDir,
      maxHeight = 720,
      preferredLang = 'en',
      timeoutMs = 300000
    } = options;

    const url = this.#buildUrl(source);
    const extractorArgs = this.#buildExtractorArgs(source, preferredLang);
    const outputTemplate = `${outputDir}/%(upload_date)s.%(ext)s`;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Codec preference order: HEVC -> AVC -> any
    const codecAttempts = ['hevc', 'avc', 'any'];

    for (const codec of codecAttempts) {
      const formatArgs = this.#buildFormatArgs(maxHeight, codec);

      // Build yt-dlp command
      // Critical: --js-runtimes node:auto fixes YouTube 403 errors
      const cmd = [
        'yt-dlp',
        '--js-runtimes node:auto',
        extractorArgs,
        formatArgs,
        '--remux-video mp4',
        '--max-downloads 1',
        '--playlist-end 1',
        `-o "${outputTemplate}"`,
        `"${url}"`
      ].filter(Boolean).join(' ');

      this.#logger.info?.('ytdlp.downloadAttempt', {
        provider: source.provider,
        codec,
        url
      });

      try {
        await this.#execWithTimeout(cmd, timeoutMs);

        // Small delay for filesystem sync
        await new Promise(r => setTimeout(r, 1000));

        // Find downloaded file
        const filePath = this.#findDownloadedFile(outputDir);
        if (!filePath) {
          this.#logger.warn?.('ytdlp.noFileFound', { provider: source.provider, codec });
          continue;
        }

        // Verify codec
        const validCodec = await this.#verifyCodec(filePath);
        if (!validCodec) {
          this.#logger.warn?.('ytdlp.invalidCodec', { provider: source.provider, filePath });
          try { fs.unlinkSync(filePath); } catch (_) {}
          continue;
        }

        const uploadDate = this.#extractUploadDate(filePath);

        this.#logger.info?.('ytdlp.downloadSuccess', {
          provider: source.provider,
          filePath,
          uploadDate
        });

        return {
          success: true,
          filePath,
          uploadDate
        };

      } catch (e) {
        this.#logger.warn?.('ytdlp.downloadError', {
          provider: source.provider,
          codec,
          error: e.message
        });

        // Clean up partial files before retry
        this.#cleanupInvalidFiles(outputDir);
      }
    }

    // All attempts failed
    this.#cleanupInvalidFiles(outputDir);

    this.#logger.error?.('ytdlp.downloadFailed', {
      provider: source.provider,
      url,
      attempts: codecAttempts.length
    });

    return {
      success: false,
      error: `Failed to download after ${codecAttempts.length} attempts`
    };
  }
}

export default YtDlpAdapter;
