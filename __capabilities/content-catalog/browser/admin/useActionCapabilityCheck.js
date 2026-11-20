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
import { useEffect, useMemo } from 'react';
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import getLogger from "../../../../frontend/src/lib/logging/Logger.js";
import { capabilityMismatch, ACTION_CAPABILITIES } from "./actionCapability.js";
import { contentInfoPath } from '../lib/contentSearchLogic.js';

const readOptions = { retryTransient: false };

function splitContentId(input) {
  const trimmed = String(input || '').trim();
  const match = trimmed.match(/^([\w-]+):\s*(.+)$/);
  if (!match) return null;
  return { source: match[1], localId: match[2].trim() };
}

/**
 * @param {string} input - the row's content id, e.g. "files:art/fhe/esther.jpg"
 * @param {string} action - the row's action ('' means Play)
 * @returns {{mismatch: {action: string, accepts: string[]}|null,
 *            suggestion: string|null, loading: boolean}}
 */
export function useActionCapabilityCheck(input, action) {
  const logger = useMemo(() => getLogger().child({ component: 'list-capability-check' }), []);
  const parsed = splitContentId(input);
  const resolvedAction = action || 'Play';
  const infoPath = Object.hasOwn(ACTION_CAPABILITIES, resolvedAction)
    ? contentInfoPath(parsed?.source, parsed?.localId)
    : null;
  const info = useApiResource(infoPath, readOptions);
  const capabilities = !info.loading && !info.error ? info.data?.capabilities : null;
  const mismatch = useMemo(() => capabilityMismatch(resolvedAction, capabilities), [resolvedAction, capabilities]);

  // Only confirmed incompatibility for the current row needs an alternate.
  const alternatesPath = mismatch
    ? `/api/v1/content/alternates/${encodeURIComponent(parsed.source)}/${encodeURIComponent(parsed.localId)}`
    : null;
  const alternates = useApiResource(alternatesPath, readOptions);
  const loading = info.loading || alternates.loading;
  const choices = !loading && !alternates.error ? alternates.data?.alternates : null;
  const suggestion = mismatch && Array.isArray(choices)
    ? choices.find(alt => Array.isArray(alt?.capabilities)
      && mismatch.accepts.some(cap => alt.capabilities.includes(cap)))?.contentId || null
    : null;
  const contentId = parsed && `${parsed.source}:${parsed.localId}`;
  useEffect(() => {
    if (!loading && mismatch) logger.warn('action.capability_mismatch', {
      contentId, action: mismatch.action, needs: mismatch.accepts, has: capabilities, suggestion,
    });
  }, [contentId, capabilities, loading, logger, mismatch, suggestion]);

  return { mismatch: loading ? null : mismatch, suggestion, loading };
}

export default useActionCapabilityCheck;
