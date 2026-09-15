/**
 * TicketIcon — an arcade ticket: a stub with notched ends and a star.
 *
 * Ported from an SVG Repo ticket (512 viewBox). The source was red with a
 * darker inner panel and a gold star; here the body colour is a parameter and
 * the inner panel is derived from it, so a "blue ticket" and a "red ticket"
 * (denominations, see the economy taxonomy) are the same component.
 *
 * No document-level ids, no gradients, so instances can repeat freely.
 * Flat fills only — this is not a `currentColor` glyph and is deliberately
 * not part of `School/home/icons/Icon.jsx`.
 */
import { useId } from 'react';
import { relight } from './iconColor.js';

export default function TicketIcon({
  size = '1em',
  color = '#d80027',
  star = '#ffda44',
  notch = '#ffffff',
  label = null,
  className = '',
}) {
  const titleId = `ticket-${useId().replace(/[^a-zA-Z0-9]/g, '')}-title`;
  const panel = relight(color, 0.37);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={`ticket-icon${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': titleId }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={titleId}>{label}</title>}
      <path
        fill={color}
        d="M492.8,150.4c-21.174,0-38.4-17.226-38.4-38.4V92.8H57.6V112c0,21.174-17.226,38.4-38.4,38.4H0v211.2h19.2c21.174,0,38.4,17.226,38.4,38.4v19.2h396.8V400c0-21.174,17.226-38.4,38.4-38.4H512V150.4H492.8z"
      />
      <rect x="89.6" y="128" width="332.8" height="256" fill={panel} />
      <polygon
        fill={star}
        points="321.958,357.499 256,322.822 190.043,357.499 202.641,284.054 149.277,232.037 223.021,221.325 256,154.501 288.979,221.325 362.723,232.037 309.361,284.054"
      />
      <g fill={notch}>
        <rect x="25.6" y="198.4" width="25.6" height="38.4" />
        <rect x="25.6" y="275.2" width="25.6" height="38.4" />
        <rect x="460.8" y="198.4" width="25.6" height="38.4" />
        <rect x="460.8" y="275.2" width="25.6" height="38.4" />
      </g>
    </svg>
  );
}
