/**
 * AreaIcon — the picture for a gem area: a running figure (move), an open book
 * (school), a game controller (games). Inline SVG on purpose: kiosks render
 * emoji and unicode symbols differently from one another. Thick strokes and
 * solid shapes so it still reads from across a garage. Painted in
 * `currentColor`; the caller sets the colour (dark on a gem, the area's own
 * colour on a section header).
 */
export const AREAS = ['move', 'school', 'games'];

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
  // A pad body with the d-pad and two buttons cut out.
  games: (
    <path fillRule="evenodd" fill="currentColor"
      d="M7 6.4 H17 A5.2 5.2 0 0 1 21.9 10 L23 15.4 A3.2 3.2 0 0 1 17.2 17.6 L15.6 15.6 H8.4 L6.8 17.6 A3.2 3.2 0 0 1 1 15.4 L2.1 10 A5.2 5.2 0 0 1 7 6.4 Z
         M6.6 8.8 H8.4 V10.6 H10.2 V12.4 H8.4 V14.2 H6.6 V12.4 H4.8 V10.6 H6.6 Z
         M15.6 9 a1.35 1.35 0 1 0 0.01 0 Z
         M18.4 11.8 a1.35 1.35 0 1 0 0.01 0 Z" />
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
