/**
 * Ask whether a list row's action is something its content can actually do,
 * and — when it isn't — whether another id addresses the same thing and can.
 *
 * The bug this exists to catch: `input: files:art/fhe/esther.jpg` with
 * `action: Display`. The `files` source reports `playable` for an image, not
 * `displayable`, so the screen rendered an empty <img>. The identical file as
 * `canvas:fhe/esther.jpg` is displayable. Nothing compared the two.
 *
 * Quietness rules, in priority order over detection:
 *   - never warn while loading
 *   - never warn when the lookup failed (a 404 is not a broken row)
 *   - never warn for an action with no trustworthy capability rule
 * A warning that fires on healthy rows gets ignored, and then it protects
 * nothing.
 */
import { useState, useEffect, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { capabilityMismatch, ACTION_CAPABILITIES } from './actionCapability.js';

// Content ids repeat across rows and every keystroke re-renders the editor, so
// results are cached by id for the life of the page. Promises are cached too,
// which collapses the burst of identical requests a freshly mounted list fires.
const cache = new Map();

/** Test seam — the cache is module state and would leak between cases. */
export function __resetCapabilityCache() {
  cache.clear();
}

function splitContentId(input) {
  const trimmed = String(input || '').trim();
  const match = trimmed.match(/^([\w-]+):\s*(.+)$/);
  if (!match) return null;
  return { source: match[1], localId: match[2].trim() };
}

function lookup(contentId, parsed) {
  if (cache.has(contentId)) return cache.get(contentId);

  const promise = (async () => {
    const info = await DaylightAPI(`/api/v1/info/${parsed.source}/${parsed.localId}`);
    return Array.isArray(info?.capabilities) ? info.capabilities : [];
  })();

  cache.set(contentId, promise);
  // A failed lookup must not be cached as "no capabilities" forever — drop it
  // so a later render can retry, and let the caller treat it as unknown.
  promise.catch(() => cache.delete(contentId));
  return promise;
}

/**
 * @param {string} input - the row's content id, e.g. "files:art/fhe/esther.jpg"
 * @param {string} action - the row's action ('' means Play)
 * @returns {{mismatch: {action: string, accepts: string[]}|null,
 *            suggestion: string|null, loading: boolean}}
 */
export function useActionCapabilityCheck(input, action) {
  const [state, setState] = useState({ mismatch: null, suggestion: null, loading: false });
  const logger = useMemo(() => getLogger().child({ component: 'list-capability-check' }), []);

  const parsed = useMemo(() => splitContentId(input), [input]);
  const resolvedAction = action || 'Play';
  // No rule means no opinion — don't even spend the request.
  const checkable = Boolean(parsed) && Boolean(ACTION_CAPABILITIES[resolvedAction]);

  useEffect(() => {
    if (!checkable) {
      setState({ mismatch: null, suggestion: null, loading: false });
      return undefined;
    }

    let cancelled = false;
    setState({ mismatch: null, suggestion: null, loading: true });

    (async () => {
      const contentId = `${parsed.source}:${parsed.localId}`;
      let capabilities;
      try {
        capabilities = await lookup(contentId, parsed);
      } catch (err) {
        // Unknown is "cannot judge", never "broken".
        logger.debug('lookup.failed', { contentId, error: err.message });
        if (!cancelled) setState({ mismatch: null, suggestion: null, loading: false });
        return;
      }

      const mismatch = capabilityMismatch(resolvedAction, capabilities);
      if (!mismatch) {
        if (!cancelled) setState({ mismatch: null, suggestion: null, loading: false });
        return;
      }

      // Only now is an alternates lookup worth a request.
      let suggestion = null;
      try {
        const res = await DaylightAPI(
          `/api/v1/content/alternates/${parsed.source}/${parsed.localId}`
        );
        const usable = (res?.alternates || []).find(alt =>
          mismatch.accepts.some(cap => (alt.capabilities || []).includes(cap))
        );
        suggestion = usable?.contentId || null;
      } catch (err) {
        logger.debug('alternates.failed', { contentId, error: err.message });
      }

      logger.warn('action.capability_mismatch', {
        contentId,
        action: mismatch.action,
        needs: mismatch.accepts,
        has: capabilities,
        suggestion,
      });
      if (!cancelled) setState({ mismatch, suggestion, loading: false });
    })();

    return () => { cancelled = true; };
    // narrowed to the exact sub-fields parsed contains — equivalent to depending on parsed itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkable, parsed?.source, parsed?.localId, resolvedAction, logger]);

  return state;
}

export default useActionCapabilityCheck;
