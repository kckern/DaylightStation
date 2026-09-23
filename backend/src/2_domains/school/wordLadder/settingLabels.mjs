/**
 * Plain words for the tunable settings (spec §7), for copy a parent reads —
 * the concern push — where a dotted setting id must never appear.
 */
export const TUNABLE_LABELS = Object.freeze({
  'round.size': 'words per round',
  'drill.afterMisses': 'misses before a word turns tricky',
  'batch.newPerDay': 'new words per day',
  'batch.workingSet': 'words in progress',
  'review.gapScale': 'review spacing',
});

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`\\b(${Object.keys(TUNABLE_LABELS).map(escape).join('|')})\\b`, 'g');

/** `text` with every tunable setting id replaced by its plain words. */
export function humanizeSettingIds(text) {
  return typeof text === 'string' ? text.replace(PATTERN, (id) => TUNABLE_LABELS[id]) : text;
}

export default TUNABLE_LABELS;
