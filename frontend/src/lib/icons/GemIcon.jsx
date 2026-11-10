/**
 * GemIcon — a faceted gem: crown, girdle and pavilion.
 *
 * Ported from a Noto-style gem (128 viewBox). The source is blue in eleven
 * facets; each facet here is the base `color` re-lit at that facet's
 * lightness, so the cut reads the same in any hue. The economy's gem colours
 * are provenance (ruby, sapphire, emerald, diamond) — pass the colour, get the
 * gem.
 *
 * No document-level ids, no gradients, so instances can repeat freely.
 */
import { useId } from 'react';
import { relight, hexToHsl } from './iconColor.js';

// Facets from the source, with each original fill's lightness. Saturation is
// eased on the palest facets so a saturated ruby still has white-ish glints.
const FACETS = [
  { d: 'M4.01 47.94l17.48-26.51L35.03 36.9z', l: 0.94, s: 0.6 },
  { d: 'M44.11 68.26L4.01 47.94L35.03 36.9z', l: 0.74 },
  { d: 'M63.94 43.06L35.03 36.9l9.08 31.36z', l: 0.68 },
  { d: 'M123.87 47.94l-17.48-26.51L92.85 36.9z', l: 0.42 },
  { d: 'M83.77 68.26l40.1-20.32L92.85 36.9z', l: 0.74 },
  { d: 'M63.94 43.06l28.91-6.16l-9.08 31.36z', l: 0.94, s: 0.6 },
  { d: 'M83.77 68.26l-19.83-25.2l-19.83 25.2z', l: 0.82, s: 0.7 },
  { d: 'M43 10.06h41.88l21.51 11.37L92.85 36.9l-28.91 6.16l-28.91-6.16l-13.54-15.47z', l: 0.86 },
  { d: 'M63.94 117.27L4.01 47.94l40.1 20.32z', l: 0.5 },
  { d: 'M63.94 117.27l59.93-69.33l-40.1 20.32z', l: 0.86 },
  { d: 'M83.77 68.26l-19.83 49.01l-19.83-49.01z', l: 0.94, s: 0.6 },
];

/**
 * `solid` keeps every facet the colour's own hue at its full saturation, lit
 * only a little either way (never toward white), so the stone reads as that
 * colour at a glance. The default is the jewel look other surfaces use.
 */
function facetFill(color, facet, solid) {
  if (!solid) return relight(color, facet.l, facet.s ?? null);
  const base = hexToHsl(color);
  if (!base) return color;
  return relight(color, Math.min(0.74, Math.max(0.24, base.l + (facet.l - 0.74) * 0.6)), base.s);
}

export default function GemIcon({
  size = '1em',
  color = '#1e88e5',
  label = null,
  className = '',
  solid = false,
}) {
  const titleId = `gem-${useId().replace(/[^a-zA-Z0-9]/g, '')}-title`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={`gem-icon${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': titleId }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={titleId}>{label}</title>}
      {FACETS.map((f, i) => (
        <path key={i} d={f.d} fill={facetFill(color, f, solid)} />
      ))}
    </svg>
  );
}
