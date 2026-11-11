/**
 * AreaIcon — the picture for a gem area: a running figure (move), an open book
 * (school), a chess knight (games). Inline SVG on purpose: kiosks render
 * emoji and unicode symbols differently from one another. Thick strokes and
 * solid shapes so it still reads from across a garage. Painted in
 * `currentColor`; the caller sets the colour (dark on a gem, the area's own
 * colour on a section header).
 */
export const AREAS = ['move', 'school', 'games'];

/** Each area's gem colour. Mirrors GEM_AREAS in __app_modules/money/economy/server/domain/earnings/gemBoard.mjs; keep the two in step. */
export const AREA_COLORS = Object.freeze({ move: '#1e88e5', school: '#f2c94c', games: '#2e9e5b' });

const DARK_INK = '#14171f';
const LIGHT_INK = '#ffffff';
/** WCAG relative luminance of a `#rrggbb` colour; null when it is not one. */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/**
 * The ink (text or icon colour) that reads on a fill of `hex`: dark or white,
 * whichever has the higher contrast (WCAG). All three area colours take dark
 * ink (citrine ~11:1, emerald ~5.6:1, sapphire ~5:1, where white would give
 * 1.6, 3.4 and 3.7); a deep colour takes white. Not a `#rrggbb` colour: white.
 */
export function inkOn(hex) {
  const l = luminance(hex);
  if (l == null) return LIGHT_INK;
  return contrast(l, luminance(DARK_INK)) >= contrast(l, 1) ? DARK_INK : LIGHT_INK;
}
export const AREA_WORDS = Object.freeze({ move: 'Move', school: 'School', games: 'Games' });

const SHAPES = {
  // Head, then body, arms and legs as round-capped strokes: a stride.
  move: (
    <>
      <circle cx="15.4" cy="4.2" r="2.7" fill="currentColor" />
      <path d="M12.6 8.6 L9.8 14.2 L14.4 17.4 L13.2 22.4 M9.8 14.2 L6 17.2 L2.8 16.2 M12.6 8.6 L17.8 10.8 L20.6 8.6 M12.6 8.6 L8 9.6 L6.2 12.4"
        fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Two solid pages with a gap for the spine.
  school: (
    <>
      <path d="M1.8 5.4 C6 4.2 9.2 4.8 11.2 6.8 V20.6 C9.2 18.8 6 18.4 1.8 19.4 Z" fill="currentColor" />
      <path d="M22.2 5.4 C18 4.2 14.8 4.8 12.8 6.8 V20.6 C14.8 18.8 18 18.4 22.2 19.4 Z" fill="currentColor" />
    </>
  ),
  // A knight facing left on a plinth, the eye cut out: one solid shape that reads at any size.
  games: (
    <path fillRule="evenodd" fill="currentColor"
      d="M6.2 18.4 H18.6 C18.9 13 18.3 8.6 15.6 5.6 C14.4 4.3 13.2 3.7 12.2 3.4 L11.4 1.4 L9.9 3.7 C8.1 4.5 6.6 6.1 5.6 8.1 L3.4 11.3 C3 12 3.4 12.9 4.2 13.1 L6.3 13.3 C7.2 13.4 8.1 12.9 8.9 12.1 L10.6 11 C10 13.8 7.6 15.6 6.2 18.4 Z
         M10 6.2 a1 1 0 1 0 0.01 0 Z
         M3.6 19.6 H20.4 A1 1 0 0 1 21.4 20.6 V22.4 H2.6 V20.6 A1 1 0 0 1 3.6 19.6 Z" />
  ),
};

export default function AreaIcon({ area, className = '' }) {
  const shape = SHAPES[area];
  if (!shape) return null;
  return (
    <svg className={`area-icon area-icon--${area}${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-area={area}>
      {shape}
    </svg>
  );
}
