// dispatchRowPhase.js — lifecycle-phase derivation for DispatchProgressTray.jsx,
// split out so Fast Refresh can hot-reload the tray component on its own.
import { outcomePhase } from './dispatchReducer.js';

/** Which lifecycle phase an outcome record is in, for rendering. */
export function rowPhase(d) {
  return outcomePhase(d);
}
