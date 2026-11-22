/** Playback volume limits accepted by both the Hub API and browser editor. */
export const VOLUME_LIMIT_MIN = 0;
export const VOLUME_LIMIT_MAX = 100;
export const DEFAULT_VOLUME_BOUNDS = Object.freeze({
  default: 60,
  min: VOLUME_LIMIT_MIN,
  max: VOLUME_LIMIT_MAX,
});

/** @param {unknown} value @returns {boolean} */
export function isValidVolumeLimit(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= VOLUME_LIMIT_MIN
    && value <= VOLUME_LIMIT_MAX;
}

/**
 * Whether resolved volume limits satisfy the Hub's persisted bounds contract.
 * @param {{default: number, min: number, max: number}|null|undefined} bounds
 * @returns {boolean}
 */
export function isValidVolumeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return false;
  const { default: defaultVolume, min, max } = bounds;
  if (![defaultVolume, min, max].every(isValidVolumeLimit)) return false;
  return min <= defaultVolume && defaultVolume <= max;
}
