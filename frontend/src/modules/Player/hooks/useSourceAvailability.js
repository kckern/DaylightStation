import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { playbackLog } from '../lib/playbackLogger.js';
import {
  decideSourceCheck,
  isSourceRefusal,
  isSuspectedRefusal,
  sourcePollDelayMs,
  toHealableContentId,
  SOURCE_UNAVAILABLE_MAX_MS,
} from '../lib/sourceAvailability.js';

/**
 * Waits out a media file the server refuses to read, instead of burning the
 * recovery ladder on it. The rules live in lib/sourceAvailability.js; this hook
 * only wires them to the element's error, timers and the backend check.
 *
 * `checkNow(reason)` asks `POST api/v1/media-source/check` (which also runs the
 * backend's repair ladder) and resolves to the decision: `wait`, `resume`,
 * `retry` or `normal`. While waiting it re-checks on a 2s/4s/8s/15s backoff.
 * `onSettled(decision)` fires for `resume` / `retry` / `normal` (and `gave-up`
 * after SOURCE_UNAVAILABLE_MAX_MS) so the caller — useMediaResilience — decides
 * what reload, if any, follows.
 */
export function useSourceAvailability({
  contentId,
  plexId = null,
  errorCode = null,
  errorMessage = null,
  mediaType = null,
  disabled = false,
  onSettled,
}) {
  const healableId = disabled ? null : toHealableContentId(contentId, plexId);
  const [unavailableSince, setUnavailableSince] = useState(null);

  const sinceRef = useRef(null);
  const attemptRef = useRef(0);
  const pollTimerRef = useRef(null);
  const inflightRef = useRef(null);
  const aliveRef = useRef(true);
  const idRef = useRef(healableId);
  idRef.current = healableId;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const endWait = useCallback(() => {
    clearPoll();
    sinceRef.current = null;
    attemptRef.current = 0;
    setUnavailableSince(null);
  }, []);

  // `suspected`: the error never named a refusal, so a readable answer hands
  // back to the stall ladder (`normal`) instead of reloading outside it.
  const checkNow = useCallback((reason, { suspected = false } = {}) => {
    const id = idRef.current;
    if (!id) return Promise.resolve('normal');
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      let state = null;
      let unreadableMs = null;
      try {
        const res = await DaylightAPI('api/v1/media-source/check', { contentId: id }, 'POST');
        state = res?.state ?? null;
        unreadableMs = res?.unreadableMs ?? null;
      } catch (error) {
        playbackLog('source-check-failed', { contentId: id, reason, error: error?.message }, { level: 'warn' });
      }
      // The item changed or the Player unmounted while we were asking.
      if (!aliveRef.current || idRef.current !== id) return 'normal';

      const waiting = sinceRef.current !== null;
      const decision = decideSourceCheck({ state, waiting, suspected });

      if (decision === 'wait') {
        if (!waiting) {
          sinceRef.current = Date.now();
          attemptRef.current = 0;
          setUnavailableSince(sinceRef.current);
          playbackLog('source-unavailable-entered', { contentId: id, reason, mediaType, backendUnreadableMs: unreadableMs }, { level: 'warn' });
        }
        const waitedMs = Date.now() - sinceRef.current;
        if (waitedMs >= SOURCE_UNAVAILABLE_MAX_MS) {
          playbackLog('source-unavailable-gave-up', { contentId: id, waitedMs, attempts: attemptRef.current }, { level: 'warn' });
          endWait();
          onSettledRef.current?.('gave-up');
          return 'gave-up';
        }
        const delayMs = sourcePollDelayMs(attemptRef.current);
        attemptRef.current += 1;
        playbackLog('source-unavailable-poll', { contentId: id, state, attempt: attemptRef.current, nextCheckMs: delayMs, waitedMs }, { level: 'debug' });
        clearPoll();
        pollTimerRef.current = setTimeout(() => {
          pollTimerRef.current = null;
          checkNow('poll');
        }, delayMs);
        return 'wait';
      }

      if (waiting) {
        playbackLog('source-unavailable-resolved', {
          contentId: id, state, decision, unavailableMs: Date.now() - sinceRef.current, attempts: attemptRef.current,
        }, { level: 'info' });
        endWait();
      } else if (decision === 'retry') {
        playbackLog('source-refusal-cleared', { contentId: id, reason }, { level: 'info' });
      }
      onSettledRef.current?.(decision);
      return decision;
    })().finally(() => {
      if (inflightRef.current === run) inflightRef.current = null;
    });
    inflightRef.current = run;
    return run;
  }, [endWait, mediaType]);

  // A refused source raises MediaError 4 ("404: Not Found"), which the recovery
  // ladder deliberately ignores (usePlaybackHealth RECOVERABLE_MEDIA_ERROR_CODES)
  // — so without this, nothing reacts until the 15s startup deadline.
  useEffect(() => {
    if (!healableId) return;
    if (sinceRef.current !== null) return; // already waiting; the poll owns it
    if (isSourceRefusal({ errorCode, errorMessage })) {
      checkNow('media-error');
    } else if (isSuspectedRefusal({ errorCode, errorMessage })) {
      // Mid-playback a refused part arrives as "Format error" or
      // "PIPELINE_ERROR_READ" with no status (2026-09-29). Ask; the answer decides.
      checkNow('media-error-suspected', { suspected: true }).then((decision) => {
        playbackLog('source-refusal-suspected', {
          contentId: healableId, errorCode, errorMessage: String(errorMessage ?? '').slice(0, 80), decision,
        }, { level: decision === 'wait' ? 'warn' : 'info' });
      });
    }
  }, [healableId, errorCode, errorMessage, checkNow]);

  // New item or unmount: drop any wait for the old one.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearPoll();
      sinceRef.current = null;
      attemptRef.current = 0;
      inflightRef.current = null;
    };
  }, [healableId]);
  useEffect(() => { setUnavailableSince(null); }, [healableId]);

  return {
    healable: Boolean(healableId),
    isUnavailable: unavailableSince !== null,
    unavailableSince,
    checkNow,
  };
}

export default useSourceAvailability;
