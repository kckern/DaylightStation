export const HOST_PHASES = Object.freeze([
  'ready', 'countdown', 'playing', 'paused', 'result', 'exiting',
]);

/** Map a game-owned phase onto the small vocabulary the host understands. */
export function projectHostPhase(phase, mapping = {}) {
  const projected = mapping[phase] ?? String(phase || '').toLowerCase();
  return HOST_PHASES.includes(projected) ? projected : 'ready';
}

export default { HOST_PHASES, projectHostPhase };
