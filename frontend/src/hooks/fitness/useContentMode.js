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

// Show id -> labels array. Module-level so it survives player remounts.
const showLabelCache = new Map();

/** Test-only cache reset. */
export function __clearContentModeCache() {
  showLabelCache.clear();
}

const showIdFor = (item) => item?.grandparentId || item?.parentId || item?.id || null;

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
      DaylightAPI(`api/v1/fitness/show/${showId}`)
        .then((res) => {
          if (cancelled) return;
          const labels = res?.info?.labels;
          if (!Array.isArray(labels)) {
            // Only a genuine array (including an empty one, for a real unlabelled show)
            // counts as a resolved answer. Anything else is treated exactly like a
            // rejected promise.
            handleAttemptFailure(attempt, 'show-label-fetch-empty', { showId });
            return;
          }
          showLabelCache.set(showId, labels);
          setFetchedLabels(labels);
        })
        .catch((err) => {
          if (cancelled) return;
          handleAttemptFailure(attempt, 'show-label-fetch-failed', { showId, error: err?.message || String(err) });
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
