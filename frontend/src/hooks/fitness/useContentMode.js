// frontend/src/hooks/fitness/useContentMode.js
import { useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { resolveContentMode, hasResolvableLabels } from './resolveContentMode.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'content-mode' });
  return _logger;
}

// Lookup id -> the TERMINAL labels array for the show that id belongs to. Module-level so
// it survives player remounts. Keyed by every id the walk below visited, because each of
// those ids genuinely resolves to the same show-level answer.
const showLabelCache = new Map();

/** Test-only cache reset. */
export function __clearContentModeCache() {
  showLabelCache.clear();
}

const showIdFor = (item) => item?.grandparentId || item?.parentId || item?.id || null;

// Plex does NOT propagate a show's labels down to its seasons or episodes. Asking
// `api/v1/fitness/show/<episodeId>` returns the EPISODE's own container info, whose
// `labels` is a real, empty array — indistinguishable, by shape alone, from a genuinely
// unlabelled show. Accepting that as a terminal answer is exactly how a labelled lesson
// ends up recorded: `resolved` flips true with `captureDisabled` false and the webcam
// starts. So an episode/season container with NO labels is not an answer at all — it is a
// signal to climb to its parent. Only a container that is not an unlabelled
// episode/season terminates the walk.
//
// Verified against the live API (show 696065, labelled `instructional`):
//   696067 -> {type:'episode', labels:[], parentRatingKey:'696066'}
//   696066 -> {type:'season',  labels:[], parentRatingKey:'696065'}
//   696065 -> {type:'show',    labels:['instructional']}
// and against an ordinary workout (Insanity, show 9956):
//   9958 -> {type:'episode', labels:[], parentRatingKey:'9957'}
//   9957 -> {type:'season',  labels:[], parentRatingKey:'9956'}
//   9956 -> {type:'show',    labels:[]}            <- still records, as it must
const CLIMBABLE_CONTAINER_TYPES = new Set(['episode', 'season']);
// episode -> season -> show. Two hops is the deepest real Plex hierarchy here; a bound
// keeps a cyclic/self-referential parentRatingKey from looping forever.
const MAX_LABEL_CLIMB_HOPS = 2;

/**
 * A lookup that produced no usable answer. Carries the log event/meta so the caller's
 * retry bookkeeping reports the specific cause without re-deriving it.
 */
class LabelLookupError extends Error {
  constructor(event, meta) {
    super(event);
    this.name = 'LabelLookupError';
    this.event = event;
    this.meta = meta;
  }
}

/**
 * Resolves the show-level labels for an id that may be an episode, a season, or a show.
 *
 * Resolves to `{ labels, visitedIds }` — `visitedIds` is every id on the path, all of
 * which map to this same terminal answer and are safe to cache. Rejects with a
 * `LabelLookupError` for anything that is not a usable answer (including an unlabelled
 * episode/season we cannot climb out of), so the caller treats it exactly like a network
 * failure: retried, never cached, `resolved` stays false, capture stays OFF.
 */
async function fetchShowLabels(startId) {
  const visitedIds = [];
  let id = String(startId);

  // hop 0 is the starting container itself, so the budget allows MAX_LABEL_CLIMB_HOPS
  // upward moves after it.
  for (let hop = 0; hop <= MAX_LABEL_CLIMB_HOPS; hop += 1) {
    if (showLabelCache.has(id)) {
      return { labels: showLabelCache.get(id), visitedIds: [...visitedIds, id] };
    }

     
    // each parent id is only known from the previous response.
    const res = await DaylightAPI(`api/v1/fitness/show/${id}`);
    const info = res?.info;
    const labels = info?.labels;
    if (!Array.isArray(labels)) {
      // Only a genuine array counts as an answer. A rejected promise and a 200-OK with
      // `info: null` (PlexAdapter.getContainerInfo() swallows internal failures) are the
      // same thing to us.
      throw new LabelLookupError('show-label-fetch-empty', { lookupId: id });
    }

    visitedIds.push(id);
    const type = typeof info?.type === 'string' ? info.type.toLowerCase() : null;
    // A NON-empty episode/season label set is a real answer — keep it. Only emptiness on
    // those types is ambiguous, because that is the shape Plex returns for "labels live
    // on the parent".
    if (!(CLIMBABLE_CONTAINER_TYPES.has(type) && labels.length === 0)) {
      return { labels, visitedIds };
    }

    const parentId = info?.parentRatingKey ?? null;
    if (!parentId) {
      throw new LabelLookupError('show-label-climb-no-parent', { lookupId: id, type });
    }
    id = String(parentId);
  }

  throw new LabelLookupError('show-label-climb-exhausted', { lookupId: String(startId) });
}

// Plex lookups are known-flaky in this deployment (requests serialize; timeouts are
// common). Every UNLABELLED show — the common case — depends on this round-trip, so a
// single transient failure must not permanently strand a session with capture off and
// the recap silently missing. Bounded retry with backoff turns a transient blip into a
// self-healing delay instead of a fleet-wide silent capture failure, WITHOUT weakening
// the fail-closed contract: `resolved` stays false for the whole retry window, and a
// failure is never cached at any attempt count.
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000]; // backoff before attempt 2 and attempt 3

/**
 * Resolves the content mode for the currently-playing item.
 *
 * Some playback paths (notably queueing straight from the fitness menu) deliver items
 * with no `labels` field, because the shared list serializer does not emit one. Treating
 * that absence as "not instructional" would record content that must never be recorded,
 * so this hook falls back to fetching the show's labels and reports `resolved: false`
 * until it knows. Callers MUST gate capture on `resolved`.
 *
 * The id it falls back on is often an EPISODE id (every metadata-fetch fallback path
 * supplies a bare `{ id }`), and Plex keeps labels only on the show — so the lookup walks
 * up from episode to season to show before it accepts an answer. See `fetchShowLabels`.
 *
 * @returns {{captureDisabled: boolean, studyUx: boolean, resolved: boolean}}
 */
export function useContentMode(item, plexConfig) {
  const [fetchedLabels, setFetchedLabels] = useState(null);

  const inline = hasResolvableLabels(item);
  const showId = showIdFor(item);
  const needsFetch = Boolean(item) && !inline && Boolean(showId);

  useEffect(() => {
    if (!needsFetch) return undefined;
    if (showLabelCache.has(showId)) {
      setFetchedLabels(showLabelCache.get(showId));
      return undefined;
    }
    let cancelled = false;
    let retryTimer = null;
    setFetchedLabels(null);

    // Handles both failure shapes identically: a rejected promise, and a 200-OK
    // response with no actual answer (e.g. PlexAdapter.getContainerInfo() swallowed an
    // internal failure and returned info: null). Neither is ever cached. Within the
    // attempt budget, schedule a backoff retry; once exhausted, give up permanently —
    // `resolved` stays false for the life of this mount, exactly as before retry existed.
    const handleAttemptFailure = (attempt, causeEvent, causeMeta) => {
      if (cancelled) return;
      logger().warn(causeEvent, { ...causeMeta, attempt });
      if (attempt < MAX_FETCH_ATTEMPTS) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        logger().warn('show-label-fetch-retry', { showId, attempt, nextAttempt: attempt + 1, delayMs });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!cancelled) runAttempt(attempt + 1);
        }, delayMs);
      } else {
        logger().warn('show-label-fetch-gave-up', { showId, attempts: attempt });
      }
    };

    const runAttempt = (attempt) => {
      fetchShowLabels(showId)
        .then(({ labels, visitedIds }) => {
          if (cancelled) return;
          // Cache under every id on the resolved path — including the id we started
          // from — so the next episode of the same show short-circuits the climb. Each
          // visited id maps to the SHOW-level answer, never to the episode-scoped empty
          // array that caused this bug.
          visitedIds.forEach((visited) => showLabelCache.set(visited, labels));
          showLabelCache.set(showId, labels);
          setFetchedLabels(labels);
        })
        .catch((err) => {
          if (cancelled) return;
          const event = err instanceof LabelLookupError ? err.event : 'show-label-fetch-failed';
          const meta = err instanceof LabelLookupError ? err.meta : { error: err?.message || String(err) };
          handleAttemptFailure(attempt, event, { showId, ...meta });
        });
    };

    runAttempt(1);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [needsFetch, showId]);

  return useMemo(() => {
    if (!item) return { captureDisabled: false, studyUx: false, resolved: true };
    if (inline) return { ...resolveContentMode(item, plexConfig), resolved: true };
    if (!showId) {
      // Nothing to fetch against. Unresolvable — keep capture off.
      return { captureDisabled: false, studyUx: false, resolved: false };
    }
    if (fetchedLabels) {
      return { ...resolveContentMode({ labels: fetchedLabels }, plexConfig), resolved: true };
    }
    return { captureDisabled: false, studyUx: false, resolved: false };
  }, [item, inline, showId, fetchedLabels, plexConfig]);
}

export default useContentMode;
