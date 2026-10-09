/**
 * Maps an item's Plex labels to the two independent content-mode flags.
 *
 * `captureDisabled` suppresses all session frame capture; `studyUx` swaps the player
 * to the study interaction model. They are deliberately independent — a show can be
 * privacy-sensitive without being instructional, and vice versa.
 *
 * Labels reach the frontend lowercased on some paths and raw on others, so both sides
 * are normalized here rather than trusted.
 */

const normalizeLabels = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.tag === 'string') return entry.tag;
      return null;
    })
    .filter(Boolean)
    .map((s) => s.toLowerCase());
};

const intersects = (itemLabels, configList) => {
  if (!Array.isArray(configList) || configList.length === 0) return false;
  const wanted = configList
    .filter((l) => typeof l === 'string')
    .map((l) => l.toLowerCase());
  return itemLabels.some((l) => wanted.includes(l));
};

/**
 * @param {object|null} item - playable item; `labels` may be absent
 * @param {object|null} plexConfig - the `plex` block from fitness.yml
 * @returns {{captureDisabled: boolean, studyUx: boolean}}
 */
export function resolveContentMode(item, plexConfig) {
  const labels = normalizeLabels(item?.labels);
  return {
    captureDisabled: intersects(labels, plexConfig?.no_capture_labels),
    studyUx: intersects(labels, plexConfig?.study_ux_labels),
  };
}

/**
 * Whether an item carries labels at all. False means the caller must resolve them
 * asynchronously before trusting a negative result — some playback paths deliver
 * items with no labels field, and treating that as "not instructional" would
 * silently record content that should never be recorded.
 */
export function hasResolvableLabels(item) {
  return Array.isArray(item?.labels) && item.labels.length > 0;
}

export default resolveContentMode;
