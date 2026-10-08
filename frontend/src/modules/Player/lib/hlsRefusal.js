/**
 * HLS refusals — turning hls.js network errors into "the source is refused".
 *
 * On a transcode the manifest answers 200 and the refusal arrives later as a
 * segment 404/503 (the proxy's replacement), which hls.js reports as a
 * `networkError` with a response code — never a MediaError — so nothing asked
 * the backend (2026-10-07). The tracker is per attached session; it raises on
 * the second refusal-status error, or at once on a fatal one.
 */

const REFUSAL_STATUS = (code) => code === 403 || code === 404 || (code >= 500 && code < 600);
const RE_RAISE_MS = 10_000;

/** What an hls.js ERROR payload says, without carrying any URL. */
export function classifyHlsError(data = {}) {
  const status = Number(data?.response?.code ?? data?.networkDetails?.status ?? 0) || null;
  const url = String(data?.frag?.url ?? data?.context?.url ?? data?.url ?? '');
  const details = String(data?.details ?? '');
  let urlKind = 'other';
  if (/manifest|level|audioTrack|subtitleTrack/i.test(details) || /\.m3u8(\?|$)/.test(url)) urlKind = 'manifest';
  if (/frag/i.test(details) || /\.(ts|m4s|mp4|aac)(\?|$)/.test(url) || /\/transcode\/universal\/session\//.test(url)) urlKind = 'segment';
  return { status, details, urlKind, fatal: data?.fatal === true, networkError: data?.type === 'networkError' };
}

export function createHlsRefusalTracker({ now = () => Date.now() } = {}) {
  let count = 0;
  let lastRaisedAt = -Infinity;
  return {
    /** @returns {null | {status, details, urlKind, fatal, count}} when a refusal should be reported. */
    observe(data) {
      const info = classifyHlsError(data);
      if (!info.networkError || !REFUSAL_STATUS(info.status ?? 0)) return null;
      count += 1;
      if (!info.fatal && count < 2) return null;
      const t = now();
      if (t - lastRaisedAt < RE_RAISE_MS) return null;
      lastRaisedAt = t;
      return { ...info, networkError: undefined, count };
    },
  };
}

export const HLS_REFUSAL_EVENT = 'daylight:hls-refusal';

/**
 * Feed one hls.js ERROR to the tracker; when it amounts to a refusal, raise
 * HLS_REFUSAL_EVENT on the element (useSourceAvailability asks the backend).
 * Always logs the facts hls.js gives (details, status, URL kind) so the next
 * incident does not have to be reconstructed from a bare `video.hls.error`.
 * @returns {boolean} true when a refusal event was raised
 */
export function reportHlsError({ video, tracker, data, logger }) {
  const info = classifyHlsError(data);
  logger?.warn?.('video.hls.error', {
    fatal: info.fatal, type: data?.type ?? null, details: info.details || null,
    status: info.status, urlKind: info.urlKind,
  });
  const refusal = tracker.observe(data);
  if (!refusal) return false;
  video?.dispatchEvent?.(new CustomEvent(HLS_REFUSAL_EVENT, { detail: refusal }));
  return true;
}
