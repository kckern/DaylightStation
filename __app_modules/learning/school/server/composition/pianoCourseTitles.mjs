/**
 * Piano course titles for learner work. A piano course id is a Plex show or a
 * season of one ('plex:<ratingKey>', older rows 'plex:plex:<ratingKey>'). A
 * season's own title is generic ("Piano"), so a season is named by its show.
 *
 * Course titles barely change, and every weekly review load asks for them, so
 * answers are cached for the process (TTL, bounded size, oldest dropped
 * first). Each Plex request is bounded by `timeoutMs`: a slow or failing
 * Plex answers null, the card reads "Piano", and nothing is cached, so the
 * next load tries again. Concurrent asks for one course share one request.
 */
import { pianoCourseKey } from '../domain/learnerWork.mjs';

const errorText = (err) => (err instanceof Error ? err.message : String(err));
const TIMED_OUT = Symbol('timed-out');

export function createPianoCourseTitleLookup({
  getPlexClient, ttlMs = 6 * 3_600_000, maxEntries = 200, timeoutMs = 2500,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, logger = {},
} = {}) {
  const cache = new Map(); // ratingKey → { title, at }
  const inFlight = new Map(); // ratingKey → Promise<string|null>

  function remember(ratingKey, title) {
    cache.delete(ratingKey);
    cache.set(ratingKey, { title, at: now() });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function fetchTitle(ratingKey) {
    const client = typeof getPlexClient === 'function' ? getPlexClient() : null;
    if (typeof client?.getContainer !== 'function') return null;
    let timer = null;
    const timeout = new Promise((resolve) => { timer = setTimer(() => resolve(TIMED_OUT), timeoutMs); });
    try {
      const data = await Promise.race([client.getContainer(`/library/metadata/${ratingKey}`), timeout]);
      if (data === TIMED_OUT) {
        logger.warn?.('school.learner-work.piano-title-timeout', { ratingKey, timeoutMs });
        return null;
      }
      const meta = data?.MediaContainer?.Metadata?.[0];
      const title = meta ? ((meta.type === 'season' ? meta.parentTitle : null) ?? meta.title ?? null) : null;
      remember(ratingKey, title);
      return title;
    } catch (err) {
      logger.warn?.('school.learner-work.piano-title-failed', { ratingKey, error: errorText(err) });
      return null;
    } finally {
      clearTimer(timer);
    }
  }

  return function pianoCourseTitleFor(courseId) {
    const key = pianoCourseKey(courseId);
    const ratingKey = key ? /^plex:(\d+)$/.exec(key)?.[1] : null;
    if (!ratingKey) return Promise.resolve(null);
    const hit = cache.get(ratingKey);
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.title);
    if (!inFlight.has(ratingKey)) {
      inFlight.set(ratingKey, fetchTitle(ratingKey).finally(() => inFlight.delete(ratingKey)));
    }
    return inFlight.get(ratingKey);
  };
}

export default createPianoCourseTitleLookup;
