import { DaylightMediaPath } from '@/lib/api.mjs';

/**
 * Interpret a session's `timelapse` block for the detail UI. The recap is a
 * silent H.264 MP4 served with byte-range support; the URL is built via
 * DaylightMediaPath (rewrites `media/…` → `/api/v1/proxy/media/…`).
 * @param {object|null|undefined} timelapse - session.timelapse
 * @returns {{ ready: boolean, processing: boolean, url: string|null }}
 */
export function deriveRecap(timelapse) {
  const ready = timelapse?.status === 'ready' && !!timelapse?.videoPath;
  return {
    ready,
    processing: timelapse?.status === 'processing',
    url: ready ? DaylightMediaPath(timelapse.videoPath) : null,
  };
}
