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
    setFetchedLabels(null);
    DaylightAPI(`api/v1/fitness/show/${showId}`)
      .then((res) => {
        const labels = res?.info?.labels;
        if (!Array.isArray(labels)) {
          // The route responds HTTP 200 even when PlexAdapter.getContainerInfo()
          // swallowed an internal failure and returned `info: null` — so a 200 does NOT
          // mean the labels are known. Only a genuine array (including an empty one, for
          // a real unlabelled show) counts as a resolved answer. Anything else is treated
          // exactly like a rejected promise: do not cache, stay unresolved.
          logger().warn('show-label-fetch-empty', { showId });
          return;
        }
        showLabelCache.set(showId, labels);
        if (!cancelled) setFetchedLabels(labels);
      })
      .catch((err) => {
        // Deliberately NOT cached and NOT resolved: an unresolvable item keeps capture
        // off rather than defaulting to recording.
        logger().warn('show-label-fetch-failed', { showId, error: err?.message || String(err) });
      });
    return () => { cancelled = true; };
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
