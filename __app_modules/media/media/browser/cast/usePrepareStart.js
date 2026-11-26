// cast/usePrepareStart.js
// Prepare on look: while the info view is open on an item, ask the server to
// warm what it can for the screen PLAY would go to.
//
// Recon (2026-11-26, Task 4 of search-to-screen): WakeAndLoadService runs its
// `prewarm` step through TranscodePrewarmService — resolve the queue, ask Plex
// for the playback decision, then fetch the MPD so the transcoder spins up.
// None of it powers, wakes, loads or commands a screen, or records history,
// progress or a session. It is exposed as `POST api/v1/device/:id/prepare
// { contentId }` (DevicePlaybackPrepareService), which refuses an unknown
// screen id and never reaches a device.
//
// What it warms is the queue resolution and Plex's playback decision ONLY.
// It passes `startTranscoder: false`, so no MPD is fetched and no transcoder
// starts on a look (a transcode per look would starve live streams). The
// server keeps that decision for two minutes against (screen, item), and
// PLAY's load on the same screen reuses it (`play.prepared-reused` on the
// server): the queue and the decision are skipped and PLAY only starts the
// transcoder on the decided URL. The server also holds at most one prepare in
// flight per screen (`busy` otherwise).
//
// What this hook therefore never does: call `device/:id/on`, `/load`, or
// anything else that touches a screen — those stay behind PLAY. A destination
// of "here" (`targetIds: []`) prepares nothing: the info the view fetched is
// all a local start needs ahead of time.
//
// Debounced 400 ms (a look that leaves at once costs nothing) and once per
// item + destination per page (module-level, for 2 minutes — the server's
// reuse window — so re-opening the item soon after does not ask again, and a
// later look renews what PLAY can reuse). One request goes to the first
// target of a multi-screen destination: its PLAY reuses the decision, the
// others decide as before. A build without the
// route (404 without DEVICE_NOT_FOUND, or 501) logs `play.prepare-unavailable`
// once and is not asked again; an unknown screen is skipped silently; a busy
// screen or any other error lets a later look try again.
import { useEffect } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import mediaLog from "../logging/mediaLog.js";

export const PREPARE_DEBOUNCE_MS = 400;
// Matches the server's PREPARED_TTL_MS (TranscodePrewarmService).
const PREPARED_FOR_MS = 2 * 60_000;

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
          // The screen was preparing something else: let a later look ask.
          if (res?.status === 'busy') prepared.delete(key);
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
