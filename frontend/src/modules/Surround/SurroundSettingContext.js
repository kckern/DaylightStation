/**
 * SurroundSettingContext — the screen-level opt-out / override for the player
 * surround frame.
 *
 * The value is a plain string, threaded from screen YAML (`surround:` on the
 * screen config) by `ScreenRenderer`:
 *
 *   'auto'  (default) — frame an item whenever the backend attached a payload.
 *   'off'             — never frame, on this screen, no matter what is authored.
 *   '<definition-id>' — forced definition. In the PoC this still only applies to
 *                       items that already carry a `surround` payload; forcing a
 *                       definition onto un-enriched items is deliberately out of
 *                       scope (see the plan's "Out of scope").
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
 * Read the setting, normalized. A missing/empty/non-string value reads as 'auto'
 * so a typo in screen YAML degrades to the default instead of disabling logging
 * or crashing a screen.
 *
 * @returns {string} 'auto' | 'off' | a definition id
 */
export function useSurroundSetting() {
  const value = useContext(SurroundSettingContext);
  return (typeof value === 'string' && value.trim()) ? value.trim() : SURROUND_AUTO;
}

export default SurroundSettingContext;
