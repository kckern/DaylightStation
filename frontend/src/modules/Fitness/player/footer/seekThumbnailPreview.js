// Patterns for detecting live-preview capable thumbnails
export const TIMESTAMP_PATTERNS = [
  /(\/indexes\/(?:sd|ld)\/)(\d+)/i,
  /(\/thumb\/)(\d+)/i,
  /(indexes%2F(?:sd|ld)%2F)(\d+)/i,
  /(thumb%2F)(\d+)/i
];

/**
 * Update thumbnail URL timestamp for live preview
 */
export const updateThumbnailTimestamp = (src, seconds) => {
  if (!src || !Number.isFinite(seconds)) return null;
  const timestamp = Math.max(0, Math.floor(seconds * 1000));
  for (const pattern of TIMESTAMP_PATTERNS) {
    if (pattern.test(src)) {
      return src.replace(pattern, (match, prefix) => `${prefix}${timestamp}`);
    }
  }
  return null;
};

/**
 * Check if thumbnail URL supports live preview
 */
export const supportsLivePreview = (src) => {
  if (!src || typeof src !== 'string') return false;
  return TIMESTAMP_PATTERNS.some((pattern) => pattern.test(src));
};
