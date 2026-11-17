// What Now Playing asks the phone app to pin to the home screen, and the words
// for the answer. The bridge contract is in __docs/reference/android/phone.md
// ("Page bridge on the phone: pinning media"); the page-side checks below
// mirror its rules so a refusal is rare, and the phone checks again anyway.

/** The phone refuses a label longer than this many code points. */
export const PIN_LABEL_MAX = 40;
const CONTENT_ID_MAX = 400;

// Control characters, line and paragraph separators: read as a space.
const SPACE_LIKE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
// Format (every bidi override and isolate, direction marks, zero-width
// characters), private-use, surrogate and unassigned characters: removed.
const REMOVED = /[\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu;

const URL_SCHEMES = new Set([
  'http', 'https', 'javascript', 'intent', 'data', 'file', 'blob', 'about',
  'content', 'ftp', 'mailto', 'vbscript', 'ws', 'wss', 'daylight',
]);
const MODIFIER_SEGMENTS = new Set(['shuffle', 'playable', 'launchable', 'recent_on_top', 'expand']);

function graphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  }
  // Without a segmenter, keep a base character with the marks that follow it.
  return text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? [];
}

/**
 * A title made safe to send as a pin label: control, format and bidi
 * characters stripped, whitespace collapsed, trimmed, then cut to 40 code
 * points on a grapheme boundary. An empty string when nothing usable is left.
 *
 * @param {unknown} title
 * @returns {string}
 */
export function pinLabel(title) {
  if (typeof title !== 'string') return '';
  const cleaned = title
    .replace(SPACE_LIKE, ' ')
    .replace(REMOVED, '')
    .replace(/\s+/gu, ' ')
    .trim();
  let out = '';
  let count = 0;
  for (const g of graphemes(cleaned)) {
    const n = [...g].length;
    if (count + n > PIN_LABEL_MAX) break;
    out += g;
    count += n;
  }
  return out.trim();
}

/**
 * True for a `source:localId` content id the phone's rule accepts: not a URL,
 * no URL-scheme source, no empty, `.` or `..` segment, no backslash, bar or
 * control character, no modifier segment, at most 400 characters.
 *
 * @param {unknown} contentId
 * @returns {boolean}
 */
export function isPinnableContentId(contentId) {
  if (typeof contentId !== 'string' || contentId.length === 0 || contentId.length > CONTENT_ID_MAX) return false;
  if (/[\p{Cc}\\|]/u.test(contentId) || contentId.includes('://')) return false;
  const colon = contentId.indexOf(':');
  if (colon <= 0 || colon === contentId.length - 1) return false;
  const source = contentId.slice(0, colon);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source) || URL_SCHEMES.has(source.toLowerCase())) return false;
  const segments = contentId.slice(colon + 1).split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'
    && !MODIFIER_SEGMENTS.has(segment.toLowerCase()));
}

function labelFor(title, contentId) {
  const label = pinLabel(title);
  // Never name a pin by its raw id.
  return label && label !== contentId ? label : '';
}

/**
 * What to pin for the item on screen: the playlist, album or show it was
 * played from when there is one, else the item itself. Null when neither has
 * a pinnable id and a usable title.
 *
 * @param {object|null} item - the session's current item
 * @param {object|null} entry - the queue entry behind it
 * @returns {{contentId: string, label: string, kind: 'container'|'item'}|null}
 */
export function pinTarget(item, entry) {
  if (!item || typeof item !== 'object') return null;
  const containerContentId = entry?.containerContentId ?? item.containerContentId ?? null;
  const itemLabel = labelFor(item.title, item.contentId);
  if (isPinnableContentId(containerContentId)) {
    const containerLabel = labelFor(entry?.containerTitle ?? item.containerTitle, containerContentId) || itemLabel;
    if (containerLabel) return { contentId: containerContentId, label: containerLabel, kind: 'container' };
  }
  if (isPinnableContentId(item.contentId) && itemLabel) {
    return { contentId: item.contentId, label: itemLabel, kind: 'item' };
  }
  return null;
}

/**
 * The sentence for the phone's answer. An accepted request only means the
 * phone's own dialog is showing, so it never says "Added".
 *
 * @param {{accepted: boolean, reason?: string}} result
 * @returns {string}
 */
export function pinOutcomeMessage(result) {
  if (result?.accepted === true) return "Confirm on your phone's dialog";
  if (result?.reason === 'rate_limited') return 'One moment, then try again';
  if (result?.reason === 'launcher_cannot_pin') return "This phone's home screen can't add shortcuts";
  return "Couldn't add to home screen";
}
