// noteSelectionEnabled.js — touch-availability gate for PianoHeroGame.jsx's
// song picker, split out so Fast Refresh can hot-reload the game screen on
// its own.
import { keyFallbackNeeded } from '../game-platform/input/touchCapability.js';

/**
 * True when this screen has no touch, so a list needs a key-driven way in.
 * `noteSelect` in config overrides it either way — a touchscreen owner may still
 * want to pick from the keys, and a test needs to force it.
 */
export function noteSelectionEnabled(config, nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (config?.noteSelect === true) return true;
  if (config?.noteSelect === false) return false;
  // One answer for "is there a finger here", shared with every other gate.
  return keyFallbackNeeded(config, nav);
}
