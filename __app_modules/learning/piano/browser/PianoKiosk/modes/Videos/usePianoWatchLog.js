// usePianoWatchLog.js
import { useCallback, useEffect, useRef } from 'react';
import { DaylightAPI } from '../../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { buildWatchLogPayload } from './watchLog.js';
import { isAtTail } from './lectureMeta.js';

const LOG_INTERVAL_MS = 10000;

/**
 * Resume-on-load + throttled play/log posting for a piano lecture.
 * `askAfterSeconds` is how long the engagement gate waits before it asks for a
 * play-along; media shorter than that is never asked (default: the 10s
 * reporting floor, which is the reading Singalong relies on).
 */
export default function usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds, userId, engagedRef, askAfterSeconds = 10, practiceReport = null, onCredit = null }) {
  const extrasRef = useRef({ practiceReport, onCredit });
  extrasRef.current = { practiceReport, onCredit };
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-video-player' });

  // Resume once, after metadata is available.
  useEffect(() => {
    if (!mediaEl || !(resumeSeconds > 0)) return undefined;
    let done = false;
    const apply = () => {
      if (done) return; done = true;
      try {
        // Second line of defence behind resumeSecondsFor: the real media
        // duration is only known here. Seeking to the tail ends it on open.
        if (isAtTail(resumeSeconds, mediaEl.duration)) {
          logger.current.warn('piano.video.resume-at-tail-skipped', { contentId, resumeSeconds, duration: mediaEl.duration });
          return;
        }
        if (mediaEl.currentTime < resumeSeconds - 1) mediaEl.currentTime = resumeSeconds;
        logger.current.info('piano.video.resume', { contentId, resumeSeconds });
      } catch (_) { /* element may detach during reload */ }
    };
    if (mediaEl.readyState >= 1) apply();
    else mediaEl.addEventListener('loadedmetadata', apply, { once: true });
    return () => mediaEl.removeEventListener('loadedmetadata', apply);
  }, [mediaEl, resumeSeconds, contentId]);

  // One post. Resolves with the server's credit answer (or null). `force`
  // skips the 10 s floor — the kiosk asks at the end of a lesson and after
  // each drill rep, when the answer decides what the child sees next.
  // The last element seen: a lesson's warm-up swaps the video out, and the
  // posts it makes after that still need the position the lesson ended at.
  const lastElRef = useRef(null);
  if (mediaEl) lastElRef.current = mediaEl;
  const sendRef = useRef(null);
  sendRef.current = (reason, { force = false } = {}) => {
    const mediaEl = lastElRef.current;
    if (!mediaEl || !contentId) return Promise.resolve(null);
    // Backend rejects seconds < 10 (nothing meaningful to resume that early),
    // so don't post until we're far enough in — avoids noisy 400s. A lecture
    // SHORTER than that floor can never reach it, though, and this is the
    // only path carrying userId/engaged: without the second clause such a
    // lecture can never be credited, and an assigned one stays owed forever.
    const { currentTime, duration } = mediaEl;
    const nearlyComplete = duration > 0 && currentTime >= duration * 0.9;
    if (!force && !(currentTime >= 10 || nearlyComplete)) return Promise.resolve(null);
    // Completion needs engagement (a play-along), and the anti-AFK gate that
    // DEMANDS one only opens after `askAfterSeconds` idle. A lecture shorter
    // than that never gives the child a chance to be asked, so recording
    // `engaged:false` there files the absence of a question as a refusal —
    // and makes such a lecture permanently uncompletable (a 77s lecture was,
    // 2026-10-28). Opening it counts, the same reading Singalong takes.
    const tooShortToAsk = duration > 0 && duration < Math.max(10, askAfterSeconds || 0);
    let practice = null;
    try { practice = extrasRef.current.practiceReport?.() ?? null; } catch { practice = null; }
    const payload = buildWatchLogPayload({
      contentId, title,
      seconds: mediaEl.currentTime,
      duration: mediaEl.duration,
      reason,
      userId,
      engaged: engagedRef?.current || tooShortToAsk,
      practice,
    });
    return DaylightAPI('api/v1/play/log', payload)
      .then((res) => {
        logger.current.debug('piano.video.log-ok', { reason, seconds: payload.seconds });
        const credit = res?.userProgress?.credit ?? null;
        try { extrasRef.current.onCredit?.(credit); } catch { /* host error must not break logging */ }
        return credit;
      })
      .catch((err) => { logger.current.warn('piano.video.log-fail', { reason, error: err.message }); return null; });
  };

  // Throttled progress logging while playing + a final post on unmount.
  useEffect(() => {
    if (!mediaEl || !contentId) return undefined;
    const id = setInterval(() => { if (!mediaEl.paused) sendRef.current('progress'); }, LOG_INTERVAL_MS);
    return () => { clearInterval(id); sendRef.current('close'); };
  }, [mediaEl, contentId, title, userId, engagedRef, askAfterSeconds]);

  const postNow = useCallback((reason = 'close') => sendRef.current(reason, { force: true }), []);
  return { postNow };
}
