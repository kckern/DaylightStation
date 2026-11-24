/**
 * courseAccessPolicy — whether a player is offered the video courses at all.
 *
 * The courses' twin of gameAccessPolicy.js, and not a lock for the same reason:
 * the daily video cap and the lesson gate say "not yet"; this says the video
 * courses are not part of this player's piano, and nothing they do today
 * changes it. So the Courses tile closes with no route to unlock, every
 * `/videos` route (grid, course, lecture, and the deep links that skip the
 * grid) shows the same closed pane, and the home strip drops the child's
 * course card.
 *
 * It covers the COURSES only. Playalong and Singalong reuse the Videos flow
 * with their own `source` and are untouched by it.
 *
 * Config: `courseAccess: { disabledFor: [ <user id>, ... ] }` in piano.yml.
 * Absent config means everyone may watch.
 */
import { gamesDisabledFor } from './gameAccessPolicy.js';

/**
 * @param {{disabledFor?: string[]}|null|undefined} courseAccess The `courseAccess` config block.
 * @param {string|null|undefined} learnerId The player being asked about.
 * @returns {boolean} True when the video courses must not be offered to this player.
 */
export function coursesDisabledFor(courseAccess, learnerId) {
  // Same id rule as games (trimmed, case-folded, junk dropped); one rule, two lists.
  return gamesDisabledFor(courseAccess, learnerId);
}

export default coursesDisabledFor;
