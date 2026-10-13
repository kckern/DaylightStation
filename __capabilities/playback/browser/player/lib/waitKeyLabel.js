/**
 * Log labels for a player's `waitKey`.
 *
 * 2026-08-16: the same field name shipped in two incompatible encodings —
 * `Player.jsx` logged the key raw (`IIni70e01E:0`), while `useMediaResilience`
 * and `usePlaybackHealth` logged an FNV-1a hash of it (`008c56a342`). The hash
 * is one-way, so a hashed line could not be mapped back to an item, and the
 * `:N` nonce ordinal — the one field that would have made a nonce climb
 * self-evident during the remount storm — was destroyed on the way in.
 *
 * The fix is `describeWaitKey`, which returns BOTH: `waitKey` raw (readable,
 * greppable, carries the ordinal) and `waitKeyHash` (stable, short, correlates
 * with every line written before this change). Log both as distinct fields.
 *
 * The absence sentinels matter as much as the encoding. The old label collapsed
 * `null`, `undefined` and `''` onto one run of zeros, so every keyless player in
 * the fleet looked like the same player. They are now three distinguishable
 * states, and neither sentinel can be mistaken for a hash (hashes are bare hex)
 * or for a real key (which is always `<identity>:<nonce>`, never parenthesised).
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** No key was supplied at all (`null` / `undefined`). */
export const WAIT_KEY_ABSENT = '(absent)';
/** A key was supplied and it was blank (`''`, or a value that serialises to ''). */
export const WAIT_KEY_EMPTY = '(empty)';

const normalizeInput = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

/**
 * The raw key, as a string, with the two absences named rather than merged.
 * @returns {string}
 */
export function getRawWaitKey(value) {
  if (value == null) return WAIT_KEY_ABSENT;
  const input = normalizeInput(value);
  return input === '' ? WAIT_KEY_EMPTY : input;
}

/**
 * Short stable digest of the key. Kept so lines written after this change still
 * join to the hashed lines written before it.
 * @returns {string} 10 hex chars, or an absence sentinel.
 */
export function getLogWaitKey(value, length = 10) {
  if (value == null) return WAIT_KEY_ABSENT;
  const input = normalizeInput(value);
  if (input === '') return WAIT_KEY_EMPTY;

  let hash = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
    hash >>>= 0;
  }

  const hex = hash.toString(16).padStart(length, '0');
  return hex.slice(0, length);
}

/**
 * Both encodings, ready to spread into a log payload:
 * `playbackLog('event', { reason, ...describeWaitKey(waitKey) })`.
 * @returns {{ waitKey: string, waitKeyHash: string }}
 */
export function describeWaitKey(value, length = 10) {
  return {
    waitKey: getRawWaitKey(value),
    waitKeyHash: getLogWaitKey(value, length)
  };
}

export default getLogWaitKey;
