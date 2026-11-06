/**
 * "Something that may earn a gem just landed" — fired by a game once its record
 * is saved (a cycle race, a Skyline Glider flight), so the gem ceremony looks at
 * the Gem Board right away instead of on a poll.
 */
export const GAME_ACHIEVEMENT_RECORDED_EVENT = 'game-achievement-recorded';

export function announceGameAchievement(source, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GAME_ACHIEVEMENT_RECORDED_EVENT, { detail: { source, ...detail } }));
}
