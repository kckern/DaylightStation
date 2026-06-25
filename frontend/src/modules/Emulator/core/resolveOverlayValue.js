/**
 * resolveOverlayValue / formatOverlayValue — pure helpers backing the bezel
 * overlay layer (heart rate, cadence, player card, credit, game-state meters).
 *
 * An overlay declares a `source` (dotted string) and a `format` hint. Resolution
 * routes by namespace so the console can keep its decoupling invariant:
 *   state.*       → live semantic StateMap (game RAM, e.g. `state.badges`)
 *   governance.*  → the governance context the console assembles
 *   anything else → the injected `overlayData` object, keyed by the full source
 *                   string (e.g. `fitness.heart_rate`, `session.current_player`)
 *
 * Formatting returns a small presentation-neutral descriptor that OverlayLayer
 * renders; it never produces JSX so it stays trivially unit-testable.
 */

const STAT_UNITS = { bpm: 'BPM', rpm: 'RPM', coins: '' };

/**
 * @param {string} source dotted source key
 * @param {{gameState?:object, governance?:object, overlayData?:object}} ctx
 * @returns {*} the raw value, or undefined when unavailable
 */
export function resolveOverlayValue(source, ctx) {
  if (!source || !ctx || typeof ctx !== 'object') return undefined;
  if (source.startsWith('state.')) {
    return ctx.gameState?.[source.slice(6)];
  }
  if (source.startsWith('governance.')) {
    return ctx.governance?.[source.slice(11)];
  }
  return ctx.overlayData?.[source];
}

/**
 * @param {string} format format hint (bpm|rpm|coins|player_card|...)
 * @param {*} value raw value from resolveOverlayValue
 * @returns {object} render descriptor
 */
export function formatOverlayValue(format, value) {
  if (value === null || value === undefined || value === '') {
    return { empty: true, text: '' };
  }
  if (format === 'player_card') {
    return {
      kind: 'player',
      name: value?.name ?? String(value),
      avatar: value?.avatar ?? null,
    };
  }
  if (Object.prototype.hasOwnProperty.call(STAT_UNITS, format)) {
    return { kind: 'stat', text: String(Math.round(Number(value))), unit: STAT_UNITS[format] };
  }
  return { kind: 'text', text: String(value) };
}

export default resolveOverlayValue;
