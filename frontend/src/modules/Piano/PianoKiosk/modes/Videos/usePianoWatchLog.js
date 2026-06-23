// usePianoWatchLog.js
import { useEffect, useRef } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';
import { buildWatchLogPayload } from './watchLog.js';

const LOG_INTERVAL_MS = 10000;

/** Resume-on-load + throttled play/log posting for a piano lecture. */
export default function usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds }) {
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-video-player' });

  // Resume once, after metadata is available.
  useEffect(() => {
    if (!mediaEl || !(resumeSeconds > 0)) return undefined;
    let done = false;
    const apply = () => {
      if (done) return; done = true;
      try {
        if (mediaEl.currentTime < resumeSeconds - 1) mediaEl.currentTime = resumeSeconds;
        logger.current.info('piano.video.resume', { contentId, resumeSeconds });
      } catch (_) { /* element may detach during reload */ }
    };
    if (mediaEl.readyState >= 1) apply();
    else mediaEl.addEventListener('loadedmetadata', apply, { once: true });
    return () => mediaEl.removeEventListener('loadedmetadata', apply);
  }, [mediaEl, resumeSeconds, contentId]);

  // Throttled progress logging while playing + a final post on unmount.
  useEffect(() => {
    if (!mediaEl || !contentId) return undefined;
    const post = (reason) => {
      const payload = buildWatchLogPayload({
        contentId, title,
        seconds: mediaEl.currentTime,
        duration: mediaEl.duration,
        reason,
      });
      DaylightAPI('api/v1/play/log', payload)
        .then(() => logger.current.debug('piano.video.log-ok', { reason, seconds: payload.seconds }))
        .catch((err) => logger.current.warn('piano.video.log-fail', { reason, error: err.message }));
    };
    const id = setInterval(() => { if (!mediaEl.paused) post('progress'); }, LOG_INTERVAL_MS);
    return () => { clearInterval(id); post('close'); };
  }, [mediaEl, contentId, title]);
}
