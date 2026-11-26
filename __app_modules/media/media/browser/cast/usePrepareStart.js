// cast/usePrepareStart.js
// Prepare on look: while the info view is open on an item, ask the server to
// warm the start on the screen PLAY would go to, so PLAY starts faster.
//
// Recon (2026-11-26, Task 4 of search-to-screen): WakeAndLoadService runs its
// `prewarm` step through TranscodePrewarmService — resolve the queue, make the
// Plex playback decision, fetch the MPD so the transcoder spins up. That work
// is pure server-side: it powers, wakes, loads and commands nothing, and it
// records no history, progress or session (it only READS resume positions).
// It is exposed as `POST api/v1/device/:id/prepare { contentId }`
// (DevicePlaybackPrepareService), which refuses an unknown screen id and never
// reaches a device. The token it mints expires unredeemed; PLAY's own load
// prewarms again and finds the transcode warm.
//
// What this hook therefore never does: call `device/:id/on`, `/load`, or
// anything else that touches a screen — those stay behind PLAY. A destination
// of "here" (`targetIds: []`) prepares nothing: the info the view fetched is
// all a local start needs ahead of time.
//
// Debounced 400 ms (a look that leaves at once costs nothing) and once per
// item + destination per page (module-level, for 5 minutes — re-opening the
// item does not ask again). The warm-up is screen-independent, so one request
// to the first target covers a multi-screen destination. A build without the
// route (404 without DEVICE_NOT_FOUND, or 501) logs `play.prepare-unavailable` once and is not asked again.
import { useEffect } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import mediaLog from "../logging/mediaLog.js";

export const PREPARE_DEBOUNCE_MS = 400;
const PREPARED_FOR_MS = 5 * 60_000;

const prepared = new Map();
let unavailable = false;

/** Test seam: forget what was prepared and whether the route exists. */
export function resetPreparedStarts() {
  prepared.clear();
  unavailable = false;
}

function preparedRecently(key, now) {
  const at = prepared.get(key);
  return at != null && now - at < PREPARED_FOR_MS;
}

export function usePrepareStart(item, targetIds) {
  const contentId = item?.contentId ?? item?.id ?? null;
  const targets = Array.isArray(targetIds) ? targetIds.filter(Boolean) : [];
  const targetKey = targets.join(',');
  useEffect(() => {
    if (!contentId || !targetKey || unavailable) return undefined;
    const key = `${contentId}|${targetKey}`;
    if (preparedRecently(key, Date.now())) return undefined;
    const ids = targetKey.split(',');
    const timer = setTimeout(() => {
      if (unavailable || preparedRecently(key, Date.now())) return;
      prepared.set(key, Date.now());
      const started = Date.now();
      DaylightAPI(`api/v1/device/${encodeURIComponent(ids[0])}/prepare`, { contentId }, 'POST')
        .then((res) => {
          mediaLog.playPrepared({ contentId, targetIds: ids, ms: Date.now() - started, status: res?.status ?? null });
        })
        .catch((err) => {
          // An unknown screen: nothing to prepare there (and not again).
          if (err?.status === 404 && err?.body?.code === 'DEVICE_NOT_FOUND') return;
          if (err?.status === 404 || err?.status === 501) {
            if (!unavailable) mediaLog.playPrepareUnavailable({ contentId, targetIds: ids, status: err.status });
            unavailable = true;
            return;
          }
          // Best-effort: let a later look try again.
          prepared.delete(key);
          mediaLog.playPrepareFailed({ contentId, targetIds: ids, error: err?.message ?? String(err) });
        });
    }, PREPARE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [contentId, targetKey]);
}

export default usePrepareStart;
