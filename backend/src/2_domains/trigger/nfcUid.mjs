/**
 * Canonical form for an NFC tag UID.
 *
 * Layer: DOMAIN (2_domains/trigger). Pure — no I/O, no config.
 *
 * WHY THIS EXISTS: the same physical tag arrives spelled differently depending
 * on which reader saw it. The household's audiobook readers write byte-separated
 * lowercase (`04_66_9c_0f_cb_2a_81`); the omr-relay's ST25R3916 emits packed
 * uppercase (`04669C0FCB2A81`). Before this existed the trigger path only
 * lowercased, so those two spellings of ONE card resolved as two different
 * tags — one registered to a learner, the other unknown.
 *
 * That is a silent identity bug, which is why normalization lives in exactly one
 * function that every reader, parser, writer and history store shares. Two
 * call sites each doing their own `.toLowerCase()` is how the drift started.
 *
 * Separators are presentation, not identity: `_`, `:` and `-` are all in use as
 * byte delimiters across vendors and none of them distinguish two real tags.
 * Verified against the live registry before adopting this: 58 curated tags and
 * 62 legacy ones canonicalize with ZERO collisions, so no two distinct tags
 * collapse into one identity.
 *
 * Deliberately NOT done here:
 *   - no length or hex validation. Legacy keys like `1001` are real registry
 *     entries, and a canonicalizer that rejected them would drop working tags.
 *     Validation, if ever wanted, belongs where a tag is enrolled.
 *   - no `0x` handling or byte reordering. No reader in this house emits either,
 *     and inventing a transform for a format we have never seen would be a
 *     guess that silently rewrites real uids.
 *
 * @module domains/trigger/nfcUid
 */

/** Separator characters seen as byte delimiters. Presentation only. */
const SEPARATORS = /[_:\-\s]/g;

/**
 * @param {unknown} value raw uid as written in config or reported by a reader
 * @returns {string} lowercase, separator-free uid; '' when there is nothing usable
 */
export function canonicalizeNfcUid(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(SEPARATORS, '').toLowerCase();
}

export default canonicalizeNfcUid;
