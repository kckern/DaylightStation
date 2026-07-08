/**
 * Pure helpers for the gamepad input-activity indicator — the dual "LED" on the
 * emulator chrome and its diagnostic logging.
 *
 * Two channels are tracked independently:
 *   - browser: what `navigator.getGamepads()` reports (the pad state the
 *     emulator *should* consume).
 *   - ejs: the `simulateInput` calls the running core actually received
 *     (tapped via EmulatorEngine.tapInput).
 *
 * When the browser channel lights but the ejs channel stays dark, input is
 * reaching the page but NOT the emulation — the exact failure that a corrupted
 * EmulatorJS re-init produces. These helpers keep that logic pure + testable;
 * the React wiring lives in EmulatorConsole.
 */

/** A ping lights its dot for this long after it lands (ms) — tuned for flicker. */
export const ACTIVE_WINDOW_MS = 140;

/**
 * True if a ping recorded at `lastPingAt` should still light the dot at `now`.
 * `lastPingAt` of 0 (never pinged) is always inactive.
 */
export function isActive(lastPingAt, now, windowMs = ACTIVE_WINDOW_MS) {
  return lastPingAt > 0 && now - lastPingAt <= windowMs;
}

/**
 * Reduce a raw `getGamepads()` snapshot to the pressed-button indices + active
 * axes per live pad. Mirrors the browser's own view of the controller. Buttons
 * count as pressed via their `.pressed` flag; an axis is "active" past a 0.5
 * deadzone (so a resting stick doesn't light the LED forever).
 *
 * @param {Array<Gamepad|null>} pads
 * @returns {Array<{slot:number,id:string,mapping:string,buttons:number[],axes:string[]}>}
 */
export function readPadActivity(pads) {
  const out = [];
  for (const gp of pads || []) {
    if (!gp) continue;
    const buttons = [];
    (gp.buttons || []).forEach((b, i) => { if (b && b.pressed) buttons.push(i); });
    const axes = (gp.axes || [])
      .map((a, i) => (Math.abs(a) > 0.5 ? `${i}:${a > 0 ? '+' : '-'}` : null))
      .filter(Boolean);
    if (buttons.length || axes.length) {
      out.push({ slot: gp.index, id: gp.id, mapping: gp.mapping, buttons, axes });
    }
  }
  return out;
}

/**
 * Stable signature across all active pads, so callers log only when the pressed
 * set actually changes (not once per frame while a button is held).
 */
export function activitySignature(active) {
  return (active || [])
    .map((a) => `${a.slot}|${a.buttons.join(',')}|${a.axes.join(',')}`)
    .join(';');
}
