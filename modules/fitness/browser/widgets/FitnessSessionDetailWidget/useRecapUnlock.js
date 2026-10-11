import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { normalizePlaybackUnlockRules, classifySessionRecap } from '../../player/playbackUnlock.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'fitness', component: 'recap-unlock' });
  return _logger;
}

/**
 * Lock a past session's recap video when the session played gated content
 * (fitness.yml → playback_unlock with `session_recaps: true`). The recap shows
 * the episode in picture-in-picture, so an open recap is a back door to the
 * cartoon itself.
 *
 * Locked from the moment a session is selected until it is classified (fail
 * closed); a grant covers only the session it was scanned for.
 *
 * @returns {{ locked: boolean, promptOpen: boolean, request: () => void, cancel: () => void }}
 */
export function useRecapUnlock({ sessionId, media, rules: rawRules, active, registerUnlock, clearUnlock, fetchInfo }) {
  const rules = useMemo(() => normalizePlaybackUnlockRules(rawRules), [rawRules]);
  const enabled = Boolean(active && rules.sessionRecaps && rules.lock && (rules.labels.size || rules.libraries.size));

  const [verdict, setVerdict] = useState(null); // { sessionId, required, reason }
  const [grantedFor, setGrantedFor] = useState(null);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    setPromptOpen(false);
    if (!enabled || !sessionId || !Array.isArray(media)) return undefined;
    let cancelled = false;
    classifySessionRecap(media, rules, fetchInfo).then((v) => {
      if (cancelled) return;
      setVerdict({ sessionId, ...v });
      if (v.required) logger().info('recap_unlock.locked', { sessionId, reason: v.reason });
    });
    return () => { cancelled = true; };
  }, [enabled, sessionId, media, rules, fetchInfo]);

  const known = verdict?.sessionId === sessionId;
  const locked = enabled && grantedFor !== sessionId && (!known || verdict.required);

  const request = useCallback(() => {
    if (!locked || promptOpen || typeof registerUnlock !== 'function') return;
    const reqSession = sessionId;
    setPromptOpen(true);
    logger().info('recap_unlock.requested', { sessionId: reqSession });
    registerUnlock(rules.lock).then((result) => {
      if (result?.matched) {
        logger().info('recap_unlock.granted', { sessionId: reqSession, userId: result.userId || null });
        setGrantedFor(reqSession);
        setPromptOpen(false);
        clearUnlock?.();
      } else {
        logger().info('recap_unlock.denied', { sessionId: reqSession, reason: result?.reason || null });
      }
    });
  }, [locked, promptOpen, sessionId, registerUnlock, rules.lock, clearUnlock]);

  const cancel = useCallback(() => {
    setPromptOpen(false);
    clearUnlock?.();
  }, [clearUnlock]);

  return { locked, promptOpen, promptTimeoutMs: rules.promptTimeoutMs, request, cancel };
}

export default useRecapUnlock;
