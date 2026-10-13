/**
 * pedalEdge — rising-edge detection for pedal/CC page turns.
 *
 * A continuous or half-depressed pedal streams many CC values per physical
 * press, so page turns must fire only on the *transition* up through the
 * threshold (prev below, value at/above), never on every value while held.
 */

/**
 * @param {number} prev      previous CC value for this controller (0 if none seen)
 * @param {number} value     incoming CC value
 * @param {number} threshold crossing point (default 64 — MIDI on/off midpoint)
 * @returns {boolean} true only on the low→high transition
 */
export function isRisingEdge(prev, value, threshold = 64) {
  return prev < threshold && value >= threshold;
}

export default { isRisingEdge };
