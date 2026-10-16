import { DaylightMediaPath } from '@/lib/api.mjs';
import { recapSpeedup } from './recapTimeMap.js';

/**
 * Interpret a session's `timelapse` block for the detail UI. The recap is a
 * silent H.264 MP4 served with byte-range support; the URL is built via
 * DaylightMediaPath (rewrites `media/…` → `/api/v1/proxy/media/…`).
 * @param {object|null|undefined} timelapse - session.timelapse
 * @param {number|null} [sessionDurationMs] - for deriving speedup on recaps that predate it
 * @returns {{ ready: boolean, processing: boolean, url: string|null, speedup: number|null }}
 */
export function deriveRecap(timelapse, sessionDurationMs = null) {
  const ready = timelapse?.status === 'ready' && !!timelapse?.videoPath;
  return {
    ready,
    processing: timelapse?.status === 'processing',
    url: ready ? DaylightMediaPath(timelapse.videoPath) : null,
    // video t ↔ session elapsed t × speedup (recapTimeMap.js)
    speedup: ready ? recapSpeedup(timelapse, sessionDurationMs) : null,
  };
}
