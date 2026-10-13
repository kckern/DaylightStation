// touchCapability.js — is there a finger available, or only a piano?
//
// One answer, asked once, rather than every game re-deriving it. The office
// screen is a Linux PC with no touchscreen; the kiosk is a tablet. A control
// that BLOCKS progress — start, play again, choose — is a dead end on the first
// and perfectly fine on the second, so the platform has to know which it is on.
//
// This is not about hiding buttons. A button is still the right affordance where
// a finger exists, and harmless where one does not. It is about guaranteeing a
// key-driven way past anything that would otherwise stop you.

/**
 * True when this screen has no touch, so every gate needs a key alternative.
 *
 * `keyFallback` in a game's config overrides the detection either way: someone
 * with a touchscreen may still prefer to drive from the keys, and a test needs
 * to force it without pretending to be a different device.
 *
 * @param {{keyFallback?: boolean}|null} [config]
 * @param {Navigator|null} [nav] - injected for testing
 */
export function keyFallbackNeeded(config = null, nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (config?.keyFallback === true) return true;
  if (config?.keyFallback === false) return false;
  // maxTouchPoints is the honest question — `ontouchstart` is present on plenty
  // of desktop browsers and would report the office screen as touch-capable.
  return !(nav?.maxTouchPoints > 0);
}

export default keyFallbackNeeded;
