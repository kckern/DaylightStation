/**
 * Stream playback vocabulary - published-language value sets.
 * @module domains/content/value-objects/StreamFormat
 *
 * Published-language playback formats a stream can resolve to. No vendor words.
 */

export const STREAM_FORMATS = Object.freeze(['video', 'hls_video', 'webview']);
export const STREAM_STRATEGIES = Object.freeze(['scrape', 'ytdlp', 'iframe']);

/** @param {string} x @returns {boolean} true if x is a published stream format. */
export function isStreamFormat(x) {
  return STREAM_FORMATS.includes(x);
}

/** @param {string} x @returns {boolean} true if x is a published stream strategy. */
export function isStreamStrategy(x) {
  return STREAM_STRATEGIES.includes(x);
}
