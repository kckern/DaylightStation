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
  const [fetchFailed, setFetchFailed] = useState(false);

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
    setFetchFailed(false);
    DaylightAPI(`api/v1/fitness/show/${showId}`)
      .then((res) => {
        const labels = Array.isArray(res?.info?.labels) ? res.info.labels : [];
        showLabelCache.set(showId, labels);
        if (!cancelled) setFetchedLabels(labels);
      })
      .catch((err) => {
        // Deliberately NOT cached and NOT resolved: an unresolvable item keeps capture
        // off rather than defaulting to recording.
        logger().warn('show-label-fetch-failed', { showId, error: err?.message || String(err) });
        if (!cancelled) setFetchFailed(true);
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
  }, [item, inline, showId, fetchedLabels, fetchFailed, plexConfig]);
}

export default useContentMode;
