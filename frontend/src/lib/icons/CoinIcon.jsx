/**
 * CoinIcon: THE household coin. Every coin drawn on a screen (silver or gold)
 * is this component. Printed receipts are text and draw no coin.
 *
 * Art: Twemoji "coin" (U+1FA99), copyright Twitter, Inc. and other
 * contributors, licensed CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
 * Source: https://github.com/twitter/twemoji (fetched via svgrepo.com/svg/405002).
 * Changes: the five fills are named roles (rim, face, highlight, inner,
 * light) and recoloured per metal. The geometry is unchanged.
 *
 * `metal` picks a palette: 'gold' (the original fills, and the default) or
 * 'silver'. `color` (a hex) is the escape hatch shared with TicketIcon and
 * GemIcon. It rebuilds the five roles as a tint ladder around that one colour
 * (`iconColor.relight`) and wins over `metal`. The only id is the labelled
 * <title>'s, from useId, so a board can draw any number of these.
 */
import { useId } from 'react';
import { relight } from './iconColor.js';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const COIN_PALETTES = Object.freeze({
  gold: Object.freeze({ rim: '#f4900c', face: '#ffcc4d', highlight: '#ffe8b6', inner: '#ffac33', light: '#ffd983' }),
  silver: Object.freeze({ rim: '#7d848c', face: '#c5c8cc', highlight: '#eff0f1', inner: '#a9afb6', light: '#dcdee0' }),
});
export const COIN_METALS = Object.freeze(Object.keys(COIN_PALETTES));

/** The five role colours for a metal, or a ladder around one hex `color`. */
export function coinPalette(metal = 'gold', color = null) {
  if (typeof color === 'string' && HEX.test(color)) {
    return {
      rim: relight(color, 0.45),
      inner: relight(color, 0.56),
      face: relight(color, 0.66),
      light: relight(color, 0.78),
      highlight: relight(color, 0.88),
    };
  }
  return COIN_PALETTES[metal] ?? COIN_PALETTES.gold;
}

// The Twemoji art in its original paint order, each shape tagged with its role.
const CIRCLES = [
  ['rim', 18, 19, 17],
  ['face', 18, 17, 17],
  ['highlight', 18, 18, 14],
  ['inner', 18, 17, 14],
];
const PATHS = [
  ['highlight', 'M9.543 10.856c0-.545.535-.763.535-.763l7.878-3.7l7.953 3.7s.548.122.548.767v.641H9.543v-.645z'],
  ['rim', 'M25.929 12.836c0-.584-.505-1.057-1.127-1.057H11.129c-.623 0-1.057.473-1.057 1.057c0 .397.204.739.529.92v.666h2.114v-.529h2.114v.529h2.114v-.529h2.114v.529h2.114v-.529h2.114v.529H25.4v-.693c.317-.188.529-.517.529-.893zM27.514 24a.793.793 0 0 1-.793.793H9.279a.793.793 0 1 1 0-1.586h17.443c.437 0 .792.355.792.793z'],
  ['rim', 'M26.457 12.2a.529.529 0 0 1-.529.529H10.071a.53.53 0 0 1 0-1.058l15.857.003a.527.527 0 0 1 .529.526zm-14.271.614h11.629V14H12.186z'],
  ['light', 'M12.714 20.829c0 .584-.316 1.057-.705 1.057h-.705c-.389 0-.705-.473-.705-1.057v-8.014c0-.584.316-1.057.705-1.057h.705c.389 0 .705.473.705 1.057v8.014zm12.686 0c0 .584-.315 1.057-.705 1.057h-.705c-.389 0-.705-.473-.705-1.057v-8.014c0-.584.315-1.057.705-1.057h.705c.389 0 .705.473.705 1.057v8.014zm-8.457 0c0 .584-.316 1.057-.705 1.057h-.705c-.389 0-.705-.473-.705-1.057v-8.014c0-.584.316-1.057.705-1.057h.705c.389 0 .705.473.705 1.057v8.014zm4.228 0c0 .584-.316 1.057-.705 1.057h-.704c-.389 0-.705-.473-.705-1.057v-8.014c0-.584.316-1.057.705-1.057h.704c.389 0 .705.473.705 1.057v8.014z'],
  ['face', 'M25.929 21.357c0 .584-.473 1.057-1.057 1.057H11.129a1.057 1.057 0 1 1 0-2.114h13.743c.583 0 1.057.473 1.057 1.057z'],
  ['light', 'M26.986 22.414c0 .584-.473 1.057-1.057 1.057H10.071a1.057 1.057 0 1 1 0-2.114h15.857c.584 0 1.058.473 1.058 1.057z'],
  ['light', 'M27.514 23.207a.793.793 0 0 1-.793.793H9.279a.793.793 0 1 1 0-1.586h17.443c.437 0 .792.355.792.793z'],
  ['face', 'M25.929 12.286c0-.584-.505-1.057-1.127-1.057H11.129c-.623 0-1.057.473-1.057 1.057c0 .397.204.739.529.92v.666h2.114v-.529h2.114v.529h2.114v-.529h2.114v.529h2.114v-.529h2.114v.529H25.4v-.693c.317-.188.529-.517.529-.893z'],
  ['light', 'M9.543 11.463c0-.545.535-.763.535-.763L17.956 7l7.953 3.7s.548.122.548.767v.291H9.543v-.295z'],
  ['inner', 'M18 8.343s-5.455 2.571-5.999 2.803c-.545.231-.363.611.001.611h11.97c.562 0 .429-.429-.017-.661C23.509 10.865 18 8.343 18 8.343z'],
  ['light', 'M26.457 11.757a.529.529 0 0 1-.529.529H10.071a.53.53 0 0 1 0-1.058l15.857.003a.527.527 0 0 1 .529.526z'],
];

export default function CoinIcon({
  metal = 'gold',
  size = '1em',
  color = null,
  label = null,
  className = '',
}) {
  const titleId = `coin-${useId().replace(/[^a-zA-Z0-9]/g, '')}-title`;
  const paint = coinPalette(metal, color);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 36 36"
      data-metal={COIN_PALETTES[metal] ? metal : 'gold'}
      className={`coin-icon${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': titleId }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={titleId}>{label}</title>}
      {CIRCLES.map(([role, cx, cy, r], i) => <circle key={`c${i}`} fill={paint[role]} cx={cx} cy={cy} r={r} />)}
      {PATHS.map(([role, d], i) => <path key={`p${i}`} fill={paint[role]} d={d} />)}
    </svg>
  );
}
