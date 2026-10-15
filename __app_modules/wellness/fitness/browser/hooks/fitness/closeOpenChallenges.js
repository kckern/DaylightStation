/**
 * Challenge ids that have a challenge_start but no challenge_end.
 * Pure — mirrors findUnclosedMedia (closeOpenMedia.js). An end-only record
 * (a challenge resolved before its start was logged) is not open.
 *
 * @param {Array<{type: string, data?: {challengeId?: string}}>} events
 * @returns {string[]}
 */
export function findOpenChallenges(events) {
  const open = new Set();
  for (const evt of events || []) {
    const id = evt?.data?.challengeId;
    if (!id) continue;
    if (evt.type === 'challenge_start') open.add(id);
    if (evt.type === 'challenge_end') open.delete(id);
  }
  return [...open];
}
