/**
 * Stream playback vocabulary - published-language value sets.
 * @module domains/content/value-objects/StreamFormat
 *
 * Published-language playback formats a stream can resolve to. No vendor words.
 */

export const STREAM_FORMATS = new Set(['video', 'hls_video', 'webview']);
export const STREAM_STRATEGIES = new Set(['scrape', 'ytdlp', 'iframe']);
