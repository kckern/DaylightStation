/**
 * "Something that may earn a gem just landed" — fired by the fitness widgets
 * once their record is saved (a cycle race, a Skyline Glider flight), so the
 * gem ceremony looks at the Gem Board right away instead of on a poll.
 */
export const ACHIEVEMENT_RECORDED_EVENT = 'fitness-achievement-recorded';

export function announceAchievement(source, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACHIEVEMENT_RECORDED_EVENT, { detail: { source, ...detail } }));
}
