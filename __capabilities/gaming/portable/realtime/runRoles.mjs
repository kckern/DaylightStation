export const RUN_ROLES = Object.freeze([
  'ready', 'countdown', 'playing', 'paused', 'result', 'exiting',
]);

/** Map a game-owned phase onto the small run-role vocabulary the host understands. */
export function projectRunRole(phase, mapping = {}) {
  const projected = mapping[phase] ?? String(phase || '').toLowerCase();
  return RUN_ROLES.includes(projected) ? projected : 'ready';
}

export default { RUN_ROLES, projectRunRole };
