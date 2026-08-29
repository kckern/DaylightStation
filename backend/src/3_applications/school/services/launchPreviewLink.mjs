/**
 * Application link codec for teacher preview navigation.
 * The launch-card preview link — one opaque segment that names WHOSE card and
 * WHICH subject, and nothing else.
 *
 * Testing a launch card used to mean minting a real panel code: printing an
 * agenda, reading six digits off it, typing them before they expired. The link
 * removes that friction and adds no authority: it carries a learner id and a
 * subject, which is exactly what the resolver already derives from a live token
 * and no more. It is not a credential, it grants nothing, and it expires never
 * because there is nothing in it to expire.
 *
 * WHY THE PAYLOAD IS ENCODED AT ALL. A plain `/launch-preview/learner4/scripture`
 * would read, to anyone walking past a Portal, as a route a child could type —
 * and the whole point of the panel is that codes are the only way in. An opaque
 * blob reads as what it is: a thing a grown-up was handed by a tool.
 *
 * THE MINIMUM IS LEARNER + SUBJECT, and that is not an arbitrary choice: it is
 * precisely what `ResolveAccessCode` pulls off a token before it resolves. A
 * unit id would be a LIE in this payload — the resolver decides the unit from
 * the learner's plan, so a link that named one would either be ignored or force
 * a card the plan does not actually offer. `continueToday` rides along because
 * it is the one other thing a live token can say, and the receipt's "one more?"
 * card is otherwise unreachable for a preview.
 *
 * DECODING NEVER GUESSES. Junk, truncation, a JSON array, an object missing a
 * field — every one of them comes back as a refusal carrying a sentence, so the
 * surface above can say why instead of rendering an empty card.
 */

export const LAUNCH_PREVIEW_LINK_SCHEMA = 'school.launch-preview-link/v1';

/**
 * Long enough for any learner id and subject the house has, short enough that a
 * pasted essay is refused before `JSON.parse` ever sees it.
 */
const MAX_LINK_LENGTH = 512;

const UNREADABLE = Object.freeze({
  ok: false,
  reason: 'unreadable',
  sentence: 'That preview link could not be read. Generate a new one.',
});

const INCOMPLETE = Object.freeze({
  ok: false,
  reason: 'incomplete',
  sentence: 'A preview link needs a learner and a subject.',
});

/**
 * @param {{learnerId: string, subject: string, continueToday?: boolean}} payload
 * @returns {string} a base64url segment safe to drop straight into a path
 */
export function encodeLaunchPreviewLink({ learnerId, subject, continueToday = false } = {}) {
  if (!learnerId || typeof learnerId !== 'string') {
    throw new Error('encodeLaunchPreviewLink: a preview link needs a learnerId');
  }
  if (!subject || typeof subject !== 'string') {
    throw new Error('encodeLaunchPreviewLink: a preview link needs a subject');
  }
  const body = JSON.stringify({
    learnerId,
    subject,
    ...(continueToday === true ? { continueToday: true } : {}),
  });
  return Buffer.from(body, 'utf8').toString('base64url');
}

/**
 * @param {string} link - the path segment, exactly as it arrived
 * @returns {{ok: true, payload: {learnerId: string, subject: string, continueToday: boolean}}
 *          |{ok: false, reason: 'unreadable'|'incomplete', sentence: string}}
 */
export function decodeLaunchPreviewLink(link) {
  if (typeof link !== 'string' || !link || link.length > MAX_LINK_LENGTH) return UNREADABLE;
  let parsed;
  try {
    // `base64url` also accepts standard base64, so a link that survived a
    // round trip through a mail client's `+`/`/` still opens.
    const decoded = Buffer.from(link, 'base64url').toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    return UNREADABLE;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return UNREADABLE;
  const learnerId = typeof parsed.learnerId === 'string' ? parsed.learnerId.trim() : '';
  const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  if (!learnerId || !subject) return INCOMPLETE;
  return {
    ok: true,
    payload: { learnerId, subject, continueToday: parsed.continueToday === true },
  };
}

export default decodeLaunchPreviewLink;
