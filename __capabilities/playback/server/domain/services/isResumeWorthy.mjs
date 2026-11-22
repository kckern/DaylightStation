/**
 * isResumeWorthy — whether a saved spot is a real place someone stopped, or
 * just a peek at the opening (picked a film, watched 25 seconds, backed out).
 * A peek starts the next play from the top.
 *
 * A spot is worth resuming when both the spot and the time actually watched
 * reach the floor: RESUME_MIN_SEC (3 minutes), or a tenth of the item's length
 * when that is shorter, so a 3-minute song or a short clip still resumes.
 * Watch time counts only when recorded (> 0); older records without it are
 * judged by the spot alone. A long jump ahead without watching is already kept
 * out of the record by isProgressCommittable.
 *
 * @param {{ playhead:number, duration:number, watchTime?:number }} progress
 * @param {{ minSec?: number }} [opts]
 * @returns {boolean}
 */
export const RESUME_MIN_SEC = 180;
export const RESUME_MIN_SHARE = 0.1;

export function resumeFloorSec(duration, minSec = RESUME_MIN_SEC) {
  const d = Number(duration);
  if (!(d > 0)) return minSec;
  return Math.min(minSec, d * RESUME_MIN_SHARE);
}

export function isResumeWorthy({ playhead, duration, watchTime } = {}, { minSec = RESUME_MIN_SEC } = {}) {
  const at = Number(playhead);
  if (!(at > 0)) return false;
  const floor = resumeFloorSec(duration, minSec);
  if (at < floor) return false;
  const watched = Number(watchTime);
  if (watched > 0 && watched < floor) return false;
  return true;
}

export default isResumeWorthy;
