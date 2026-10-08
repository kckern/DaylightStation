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
import { HLS_REFUSAL_EVENT } from '../lib/hlsRefusal.js';

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
  // Owner option (monitor.sourceUnavailableMaxMs): how long to wait before
  // `gave-up`. The final check is scheduled to land on the limit itself.
  maxWaitMs = SOURCE_UNAVAILABLE_MAX_MS,
  // Owner report: ({ waiting: true, since }) when a wait opens and
  // ({ waiting: false, decision }) when it ends (resume/normal/gave-up/abandoned).
  onWaitChange,
  // Screens hold (owner ruling 2026-10-07, screen-framework owners ONLY): a
  // CONFIRMED refusal the backend cannot judge keeps waiting instead of falling
  // to the ladder and its skip. Fitness / piano / school Players never set it.
  holdOnRefusal = false,
  // The renderer's element, for the HLS refusal event (hls.js errors are not
  // MediaErrors). `registrationSignal` re-runs the attach when it appears.
  getMediaEl = null,
  registrationSignal = null,
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
  const onWaitChangeRef = useRef(onWaitChange);
  onWaitChangeRef.current = onWaitChange;
  const maxWaitRef = useRef(maxWaitMs);
  maxWaitRef.current = Number.isFinite(maxWaitMs) && maxWaitMs > 0 ? maxWaitMs : SOURCE_UNAVAILABLE_MAX_MS;

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
    unknownRef.current = 0;
    setUnavailableSince(null);
  }, []);

  // `suspected`: the error never named a refusal, so a readable answer hands
  // back to the stall ladder (`normal`) instead of reloading outside it.
  const unknownRef = useRef(0);
  const holdRef = useRef(holdOnRefusal);
  holdRef.current = holdOnRefusal;

  // `confirmed`: the element/renderer named a refusal (403/404/503). It tells
  // the backend the PROXY refused the file (refresh it even if Plex says
  // readable) and lets a screen keep waiting when the backend cannot judge.
  const checkNow = useCallback((reason, { suspected = false, confirmed = false } = {}) => {
    const id = idRef.current;
    if (!id) return Promise.resolve('normal');
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      let state = null;
      let unreadableMs = null;
      let checkFailed = false;
      let res = null;
      try {
        res = await DaylightAPI(
          'api/v1/media-source/check',
          { contentId: id, ...(confirmed ? { origin: 'proxy' } : {}) },
          'POST',
        );
        state = res?.state ?? null;
        unreadableMs = res?.unreadableMs ?? null;
      } catch (error) {
        checkFailed = true;
        playbackLog('source-check-failed', { contentId: id, reason, error: error?.message }, { level: 'warn' });
      }
      // The item changed or the Player unmounted while we were asking.
      if (!aliveRef.current || idRef.current !== id) return 'normal';

      const waiting = sinceRef.current !== null;
      const answered = state === 'unreadable' || state === 'readable' || state === 'missing';
      // Only a real `unknown` ANSWER counts toward "treated as missing"; a failed
      // request (backend restarting mid-deploy) says nothing about the file.
      if (answered) unknownRef.current = 0;
      // Only `no-metadata` (Plex answered: no such item) means deleted. A
      // reasonless `unknown` is also what a Plex outage produces.
      else if (!checkFailed && res?.reason === 'no-metadata') unknownRef.current += 1;
      const decision = decideSourceCheck({
        state, waiting, suspected, hold: holdRef.current, confirmed,
        unknownPolls: unknownRef.current,
      });

      if (decision === 'wait') {
        if (!waiting) {
          sinceRef.current = Date.now();
          attemptRef.current = 0;
          setUnavailableSince(sinceRef.current);
          playbackLog('source-unavailable-entered', { contentId: id, reason, mediaType, backendUnreadableMs: unreadableMs, maxWaitMs: maxWaitRef.current }, { level: 'warn' });
          onWaitChangeRef.current?.({ waiting: true, since: sinceRef.current, contentId: id });
        }
        const waitedMs = Date.now() - sinceRef.current;
        if (waitedMs >= maxWaitRef.current) {
          playbackLog('source-unavailable-gave-up', { contentId: id, waitedMs, attempts: attemptRef.current, maxWaitMs: maxWaitRef.current }, { level: 'warn' });
          endWait();
          onWaitChangeRef.current?.({ waiting: false, decision: 'gave-up', contentId: id, waitedMs });
          onSettledRef.current?.('gave-up');
          return 'gave-up';
        }
        const delayMs = Math.max(250, Math.min(sourcePollDelayMs(attemptRef.current), maxWaitRef.current - waitedMs));
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
        const unavailableMs = Date.now() - sinceRef.current;
        playbackLog('source-unavailable-resolved', {
          contentId: id, state, decision, unavailableMs, attempts: attemptRef.current,
        }, { level: 'info' });
        endWait();
        onWaitChangeRef.current?.({ waiting: false, decision, contentId: id, waitedMs: unavailableMs });
      } else if (decision === 'retry') {
        playbackLog('source-refusal-cleared', { contentId: id, reason }, { level: 'info' });
      }
      onSettledRef.current?.(decision, { reason, suspected });
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
  // The element error is latched per load cycle and reset only after the
  // render that switches items, so on that first render it still belongs to
  // the PREVIOUS item. Never ask about the new file on the old element's error
  // (2026-10-03: the next queue item was force-remounted and never started).
  const errorOwnerRef = useRef(healableId);
  useEffect(() => {
    if (errorOwnerRef.current !== healableId) {
      errorOwnerRef.current = healableId;
      return;
    }
    if (!healableId) return;
    if (sinceRef.current !== null) return; // already waiting; the poll owns it
    if (isSourceRefusal({ errorCode, errorMessage })) {
      checkNow('media-error', { confirmed: true });
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

  // HLS: a segment/manifest refusal never becomes a MediaError, so the renderer
  // raises a DOM event on the element instead (see lib/hlsRefusal.js).
  useEffect(() => {
    if (!healableId) return undefined;
    const el = getMediaEl?.();
    if (!el?.addEventListener) return undefined;
    const onHlsRefusal = (event) => {
      const detail = event?.detail || {};
      if (sinceRef.current !== null) return; // already waiting; the poll owns it
      // 5xx other than 503 is only SUSPECTED: the proxy's own replacement is 503.
      const confirmed = detail.status === 403 || detail.status === 404 || detail.status === 503;
      checkNow('hls-refusal', { suspected: true, confirmed }).then((decision) => {
        playbackLog('refusal-hls', {
          contentId: healableId, status: detail.status ?? null, details: detail.details ?? null,
          urlKind: detail.urlKind ?? null, fatal: detail.fatal === true, count: detail.count ?? null, decision,
        }, { level: decision === 'wait' ? 'warn' : 'info' });
      });
    };
    el.addEventListener(HLS_REFUSAL_EVENT, onHlsRefusal);
    return () => el.removeEventListener?.(HLS_REFUSAL_EVENT, onHlsRefusal);
  }, [healableId, getMediaEl, registrationSignal, checkNow]);

  // New item or unmount: drop any wait for the old one.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearPoll();
      if (sinceRef.current !== null) {
        onWaitChangeRef.current?.({ waiting: false, decision: 'abandoned', contentId: idRef.current });
      }
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
