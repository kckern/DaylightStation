// backend/src/1_adapters/content/media/youtube/YouTubeAdapter.mjs

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PIPED_TIMEOUT_MS = 5000;
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * YouTubeAdapter — resolves YouTube video IDs to direct stream URLs
 * via self-hosted Piped API. Falls back to YouTube embed on any failure.
 */
export class YouTubeAdapter {
  #host;
  #logger;
  #cache = new Map();
  #consecutiveFailures = 0;
  #circuitBrokenUntil = 0;

  constructor({ host, logger = console }) {
    if (!host) throw new Error('YouTubeAdapter requires host (Piped API URL)');
    this.#host = host.replace(/\/$/, '');
    this.#logger = logger;
  }

  /**
   * Get stream info for a YouTube video.
   * @param {string} videoId
   * @param {Object} [opts]
   * @param {string} [opts.quality='360p'] - '360p', '480p', or '720p'
   * @returns {Promise<Object|null>} Stream info or null on failure
   */
  async getStreamInfo(videoId, { quality = '360p' } = {}) {
    if (!videoId) return null;

    // Circuit breaker: skip Piped if it's been failing
    if (Date.now() < this.#circuitBrokenUntil) {
      this.#logger.debug?.('youtube.adapter.circuit-open', { videoId });
      return null;
    }

    // Check cache
    const cacheKey = `stream:${videoId}`;
    const cached = this.#getFromCache(cacheKey);
    if (cached) return this.#selectStreams(cached, quality);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PIPED_TIMEOUT_MS);

      const res = await fetch(`${this.#host}/streams/${encodeURIComponent(videoId)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Piped API ${res.status}`);

      const data = await res.json();
      this.#consecutiveFailures = 0;
      this.#putInCache(cacheKey, data);
      return this.#selectStreams(data, quality);
    } catch (err) {
      this.#consecutiveFailures++;
      this.#logger.warn?.('youtube.adapter.piped.failed', {
        videoId,
        error: err.message,
        consecutiveFailures: this.#consecutiveFailures,
      });

      if (this.#consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) {
        this.#circuitBrokenUntil = Date.now() + CIRCUIT_BREAK_DURATION_MS;
        this.#logger.warn?.('youtube.adapter.circuit-break', {
          until: new Date(this.#circuitBrokenUntil).toISOString(),
        });
      }

      return null;
    }
  }

  /**
   * Get detail sections for a YouTube video (feed detail format).
   * Always returns a valid response — embed fallback on Piped failure.
   * @param {string} videoId
   * @param {Object} [opts]
   * @param {string} [opts.quality='360p']
   * @returns {Promise<Object>} { sections: [...] }
   */
  async getDetail(videoId, { quality = '360p' } = {}) {
    const embedFallback = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;

    const streamInfo = await this.getStreamInfo(videoId, { quality });

    if (!streamInfo) {
      // Piped failed — return embed-only
      return {
        sections: [{
          type: 'embed',
          data: { provider: 'youtube', url: embedFallback, aspectRatio: '16:9' },
        }],
      };
    }

    // Native player with embed fallback baked in
    return {
      sections: [{
        type: 'player',
        data: {
          provider: 'youtube',
          ...streamInfo,
          embedFallback,
        },
      }],
    };
  }

  // ======================================================================
  // Stream selection
  // ======================================================================

  #selectStreams(data, quality) {
    const videoStreams = data.videoStreams || [];
    const audioStreams = data.audioStreams || [];
    const duration = data.duration || null;
    const meta = {
      duration,
      title: data.title || null,
      uploader: data.uploader || null,
      thumbnailUrl: data.thumbnailUrl || null,
    };

    // For 360p: use combined stream (videoOnly=false)
    if (quality === '360p') {
      const combined = videoStreams.find(
        s => !s.videoOnly && s.mimeType?.startsWith('video/mp4')
      );
      if (combined) {
        return { url: combined.url, mimeType: combined.mimeType || 'video/mp4', ...meta };
      }
      // No combined stream — try any combined stream
      const anyCombined = videoStreams.find(s => !s.videoOnly);
      if (anyCombined) {
        return { url: anyCombined.url, mimeType: anyCombined.mimeType || 'video/mp4', ...meta };
      }
      return null;
    }

    // For 480p/720p: video-only + audio
    const targetQuality = quality === '720p' ? '720p' : '480p';
    const videoOnly = this.#findBestVideoStream(videoStreams, targetQuality);
    const audio = this.#findBestAudioStream(audioStreams);

    if (videoOnly && audio) {
      return {
        videoUrl: videoOnly.url,
        audioUrl: audio.url,
        mimeType: videoOnly.mimeType || 'video/mp4',
        ...meta,
      };
    }

    // Fallback: try combined 360p
    return this.#selectStreams(data, '360p');
  }

  #findBestVideoStream(streams, targetQuality) {
    // Prefer mp4, match target quality, fall back to nearest lower
    const mp4Only = streams.filter(s => s.videoOnly && s.mimeType?.startsWith('video/mp4'));
    const exact = mp4Only.find(s => s.quality === targetQuality);
    if (exact) return exact;

    // Fall back to nearest quality
    const qualityOrder = ['720p', '480p', '360p', '240p', '144p'];
    const targetIdx = qualityOrder.indexOf(targetQuality);
    for (let i = targetIdx + 1; i < qualityOrder.length; i++) {
      const fallback = mp4Only.find(s => s.quality === qualityOrder[i]);
      if (fallback) return fallback;
    }
    return mp4Only[0] || null;
  }

  #findBestAudioStream(streams) {
    // Prefer mp4 audio, highest bitrate
    const mp4Audio = streams
      .filter(s => s.mimeType?.startsWith('audio/mp4'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return mp4Audio[0] || streams[0] || null;
  }

  // ======================================================================
  // Cache helpers (same pattern as YouTubeFeedAdapter)
  // ======================================================================

  #getFromCache(key) {
    const entry = this.#cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.#cache.delete(key);
      return null;
    }
    return entry.data;
  }

  #putInCache(key, data) {
    this.#cache.set(key, { data, ts: Date.now() });
    if (this.#cache.size > 100) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
  }
}
