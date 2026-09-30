/**
 * The TV's half of adoption: prove that what is playing right now is the book
 * the server asked this screen to adopt, and say exactly where it is.
 *
 * WHY THE TV DECIDES. The server knows only that a book was the last thing
 * dispatched unclaimed at this reader (`ReadingSessionService#unclaimedPlay`).
 * `isPlaying` is a bare boolean, so the server cannot tell the child's story
 * from a film somebody started from a phone since. The session source can: it
 * names the playing TRACK and its position. A book tag names the ALBUM
 * (`plex:674736` played track `plex:674737` on 2026-09-30), so the book's own
 * queue is the bridge — the track must be in it.
 *
 * Every answer that is not a proof is a decline. D2 — a reading session never
 * seizes the TV — is restored by the caller for all three.
 *
 * NO `seconds` ON THE RETURNED QUEUE. The Player's media controller applies a
 * start offset only to video or audio longer than 12 minutes, and resets any
 * offset within 30 s of the end, so a 4:52 book would restart at 0:00. The
 * reading stage seeks the element itself on its first frame instead.
 *
 * Pure apart from the injected `fetchQueue`; never throws.
 */
const LIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled', 'loading', 'ready']);
const SIDE_EFFECT = 'trigger/side-effect';

/**
 * @param {object} args
 * @param {object|null} args.capture - `sessionSource.capture()`
 * @param {string} args.bookContentId - the contentId the book tag resolved to
 * @param {(contentId: string) => Promise<{items?: object[]}>} args.fetchQueue
 * @returns {Promise<{ok: true, play: object[], positionSec: number, trackContentId: string}
 *   | {ok: false, reason: 'no-owner'|'not-playing'|'content-mismatch'}>}
 */
export async function resolveAdoptablePlayback({ capture, bookContentId, fetchQueue }) {
  const trackContentId = capture?.currentItem?.contentId ?? null;
  if (!capture || !trackContentId) return { ok: false, reason: 'no-owner' };
  if (!LIVE_STATES.has(capture.state)) return { ok: false, reason: 'not-playing' };

  let items = [];
  try {
    const body = await fetchQueue(bookContentId);
    items = Array.isArray(body?.items) ? body.items.filter((item) => item?.mediaType !== SIDE_EFFECT) : [];
  } catch {
    return { ok: false, reason: 'content-mismatch' };
  }
  const index = items.findIndex((item) => item?.contentId === trackContentId);
  if (index < 0) return { ok: false, reason: 'content-mismatch' };

  const position = Number(capture.position);
  return {
    ok: true,
    play: items.slice(index),
    positionSec: Number.isFinite(position) && position > 0 ? position : 0,
    trackContentId,
  };
}

export default resolveAdoptablePlayback;
