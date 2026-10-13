/**
 * SurroundSettingContext — the screen-level opt-out / override for the player
 * surround frame.
 *
 * The value is a plain string, threaded from screen YAML (`surround:` on the
 * screen config) by `ScreenRenderer`:
 *
 *   'auto'  (default) — frame an item whenever the backend attached a payload.
 *   'off'             — never frame, on this screen, no matter what is authored.
 *
 * THOSE ARE THE ONLY TWO VALUES. A forced-definition mode was documented here
 * for a wave, normalized, threaded from screen YAML and read by the mount log —
 * and behaved in every respect exactly like 'auto', because the frame's
 * definition comes from the item's payload and nothing ever consulted the
 * setting for one. A configuration value that silently does nothing is worse
 * than a missing feature: it is a screen author's afternoon. Anything that is
 * not 'off' is 'auto', and this comment is the whole contract.
 *
 * The DEFAULT IS 'auto', which matters: every Player mount outside the screen
 * framework (Fitness, Piano, School, Feed, Media, Admin) reads this default
 * without a Provider, and so does a MenuStack mounted on its own. Those seams are
 * unchanged because they never mount `SurroundHost`, not because the context
 * turns them off.
 *
 * Screen YAML is unvalidated pass-through (`screens.mjs` serves it raw), so an
 * unrecognized value must degrade to "behave like auto" rather than throw.
 */

import { createContext, useContext } from 'react';

/** Frame whenever the played item carries a surround payload. */
export const SURROUND_AUTO = 'auto';
/** Never frame on this screen. */
export const SURROUND_OFF = 'off';

export const SurroundSettingContext = createContext(SURROUND_AUTO);

/**
 * Read the setting, normalized. Anything that is not 'off' reads as 'auto' — a
 * typo in screen YAML degrades to the default instead of disabling logging or
 * crashing a screen, and an unsupported value cannot pretend to be a mode.
 *
 * @returns {'auto'|'off'}
 */
export function useSurroundSetting() {
  const value = useContext(SurroundSettingContext);
  const normalized = (typeof value === 'string' && value.trim()) ? value.trim() : SURROUND_AUTO;
  return normalized === SURROUND_OFF ? SURROUND_OFF : SURROUND_AUTO;
}

export default SurroundSettingContext;
