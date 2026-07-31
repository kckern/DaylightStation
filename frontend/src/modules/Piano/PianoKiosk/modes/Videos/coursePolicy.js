// coursePolicy.js — per-user course-viewing policy (piano.yml videos.user_policies).
//
// House default is the strict one: the engagement gate runs on sequential
// courses, and a finished lecture returns to the menu. A per-user entry can
// relax either — engagement_gate: false permits passive watching (no
// play-a-note prompt), auto_advance: true rolls a finished lecture straight
// into the next episode. Only the gate/end behavior is per-user; sequential
// locking and the seek-forward lock are untouched.
import { lectureContentId } from './lectureMeta.js';

export function resolveCoursePolicy(videosConfig, userId) {
  const entry = (userId && videosConfig?.user_policies?.[userId]) || {};
  return {
    engagementGate: entry.engagement_gate !== false,
    autoAdvance: entry.auto_advance === true,
  };
}

/**
 * The lecture auto-advance lands on: the next item after `currentLectureId`
 * (in the course's delivered order) that has a playable contentId, or null at
 * the end. In a sequential course the next linear episode is exactly the one
 * that finishing the current lecture unlocks, so this never jumps a lock.
 */
export function nextLectureAfter(items, currentLectureId) {
  const list = Array.isArray(items) ? items : [];
  const idx = list.findIndex((l) => String(lectureContentId(l)) === String(currentLectureId));
  if (idx < 0) return null;
  for (let i = idx + 1; i < list.length; i += 1) {
    if (lectureContentId(list[i])) return list[i];
  }
  return null;
}
