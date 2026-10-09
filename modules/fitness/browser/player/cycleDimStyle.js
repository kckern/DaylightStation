/**
 * cycleDimStyle — pure helper that maps a governance `challenge` snapshot
 * to the CSS custom property + className needed to drive progressive video
 * degradation during a cycle challenge.
 *
 * Task 20: The GovernanceEngine emits `challenge.dimFactor` in [0..1] when a
 * cycle challenge is in maintain state and the rider's RPM is in the
 * [loRpm, hiRpm) band. The factor is 0 at/above hiRpm (fully clear video)
 * and approaches 1 as RPM drops toward loRpm (maximally degraded).
 *
 * This helper is isolated from FitnessPlayer.jsx so the mapping can be
 * unit-tested under Jest's `testEnvironment: 'node'` without needing RTL
 * or jsdom. The FitnessPlayer component just spreads the returned `style`
 * onto the player root and appends `className` to its class list.
 *
 * Contract:
 *   - `style['--cycle-dim']`: string in [0..1], the backend dim factor
 *     (clamped; invalid values → '0'). Always present so the SCSS
 *     `var(--cycle-dim, 0)` fallback is never actually needed once the
 *     player has rendered once.
 *   - `className`: either `'cycle-dim'` (activate filter chain) or `''`
 *     (no filter). Only set on cycle challenges in maintain state —
 *     other states don't apply the video filter even though the factor
 *     may be live on the engine side.
 *
 * @param {object|null|undefined} challenge  Governance snapshot `challenge`
 *   field. When the cycle branch is active it has shape
 *   `{ type: 'cycle', cycleState, dimFactor, ... }`.
 * @returns {{ style: Record<string,string>, className: string }}
 */
export function computeCycleDimStyle(challenge) {
  const isCycle = !!challenge && challenge.type === 'cycle';
  const isMaintain = isCycle && challenge.cycleState === 'maintain';

  // Only cycle challenges contribute a factor. Non-cycle (or no challenge)
  // leaves the CSS var at 0 so the SCSS filter chain is a no-op.
  let rawFactor = 0;
  if (isCycle && typeof challenge.dimFactor === 'number' && Number.isFinite(challenge.dimFactor)) {
    rawFactor = challenge.dimFactor;
  }

  // Clamp to [0, 1].
  const clamped = Math.max(0, Math.min(1, rawFactor));

  // Stringify without forcing a decimal representation — `String(0)` is '0',
  // `String(0.5)` is '0.5'. This preserves readable DevTools values.
  const varValue = String(clamped);

  return {
    style: { '--cycle-dim': varValue },
    className: isMaintain ? 'cycle-dim' : ''
  };
}
