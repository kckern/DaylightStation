// icons.jsx — ONE icon language for the Composer mode.
//
// WHY hand-drawn SVG and not Unicode: the kiosk tablet's WebView ships no font
// covering the music block or the symbol glyphs a toolbar reaches for, so
// `♩.`, `↶`, `↷`, `☰`, `ⓘ`, `＋` and `⌫` all painted as TOFU BOXES on the only
// screen this mode runs on. DurationPalette's note glyphs were already drawn by
// hand for exactly this reason; this file finishes the job so the whole toolbar
// speaks one language instead of half SVG and half empty rectangles.
//
// HOUSE PATTERN (match it when adding one): a 24-unit grid, `currentColor` for
// every fill and stroke so an icon survives the accent-fill, disabled and
// danger states its button can be in, stroke width 1.7 with round caps/joins to
// sit alongside DurationPalette's NoteGlyph, and `aria-hidden` — the BUTTON
// owns the accessible name, and an icon that also announced itself would make
// every control read its label twice.

// Shared frame. `size` is the RENDERED box; the 24-unit viewBox is fixed, which
// is what keeps a 22px nav icon and a 30px palette icon optically consistent.
function Svg({ size = 22, className, children }) {
  return (
    <svg
      className={className ? `composer-icon ${className}` : 'composer-icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Undo / Redo — an arrowhead doubling back over a half-turn. Mirrored pairs, so
// "which way does this go" is answered by the shape and not by reading a label.
export function IconUndo(props) {
  return (
    <Svg {...props}>
      <path d="M8.5 7.5H15a5 5 0 0 1 0 10h-3.5" />
      <path d="M11.5 4.5 8 7.5l3.5 3" />
    </Svg>
  );
}

export function IconRedo(props) {
  return (
    <Svg {...props}>
      <path d="M15.5 7.5H9a5 5 0 0 0 0 10h3.5" />
      <path d="M12.5 4.5 16 7.5l-3.5 3" />
    </Svg>
  );
}

// Backspace — the keycap shape (a rectangle with its left edge drawn to a
// point) with the erase cross inside. Deliberately NOT an arrow: this sits one
// control away from note-entry buttons, and an arrow would read as caret motion.
export function IconBackspace(props) {
  return (
    <Svg {...props}>
      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6.5-7z" />
      <path d="M12.5 9.5 17 14M17 9.5l-4.5 4.5" />
    </Svg>
  );
}

// Transport. Filled, because play/pause are the only SOLID marks in the set —
// they are the mode's one primary action and should read as a button face.
export function IconPlay(props) {
  return (
    <Svg {...props}>
      <path d="M8.5 5.5 18.5 12l-10 6.5z" fill="currentColor" />
    </Svg>
  );
}

export function IconPause(props) {
  return (
    <Svg {...props}>
      <rect x="7.5" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="12.9" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Songs — a stack of lines with a note sitting on the last one: the universal
// "list of music" mark. Not a plain list (that reads as a menu) and not a bare
// note (that reads as note ENTRY, which is what most of this toolbar does).
export function IconSongs(props) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h16M4 11.5h9M4 16.5h6" />
      <ellipse cx="15.6" cy="18.2" rx="2.6" ry="2.05" fill="currentColor" stroke="none" />
      <path d="M18.2 18.2V10.2" />
    </Svg>
  );
}

export function IconInfo(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="7.9" r="1.15" fill="currentColor" stroke="none" />
      <path d="M12 11.4v5.4" />
    </Svg>
  );
}

export function IconPlus(props) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// Close. Not in the original icon list, but the help panel's `✕` is the same
// class of bug as the ones that were: a Unicode symbol standing in for a mark,
// on the modal's only VISIBLE dismiss. Escape needs a keyboard the tablet does
// not have and tapping the backdrop is undiscoverable, so if that character has
// no glyph the panel becomes a dead end.
export function IconClose(props) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

// The augmentation dot. A bare circle IS the notation — it only means "dotted"
// when it sits to the right of a notehead, which is how DurationPalette places
// it (NoteGlyph, then this).
export function IconDot(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/**
 * MODERN quarter rest — the zigzag with a terminal hook.
 *
 * Drawn by hand rather than taken from Wikimedia on purpose. The public-domain
 * Commons file (`Crotchet_rest_plain-svg.svg`) is the ARCHAIC form — a mirrored
 * eighth rest — and OSMD engraves the modern form on the staff a few inches
 * below this toolbar. Shipping the archaic glyph would put two different
 * "quarter rest" shapes on one screen and teach a kid learning to read rests
 * that they are the same mark, which is worse than no icon at all.
 *
 * Filled rather than stroked (the rest of the set is line art): the real glyph's
 * whole identity is in its varying thickness — thin diagonals swelling into the
 * turns — and a constant-width stroke reads as a lightning bolt instead.
 *
 * PROPORTIONS taken by measuring, not by eye. OSMD's engraved rest bounding box
 * is 8.4 x 28.5 (w/h 0.295), i.e. far narrower than it feels when drawing one;
 * a first attempt at w/h 0.34 with a fatter waist read as a blocky "Z" beside
 * the real glyph. This sits at roughly 5.6 x 18 in the 24-unit box, and was
 * picked by rendering candidates against an actual engraved rest.
 */
export function IconQuarterRest(props) {
  return (
    <Svg {...props}>
      <path
        d="M10.05 3.05c.18-.2.5-.13.62.1l3.9 5.55c.36.5.3.9-.1 1.3l-2.85 2.9c-.42.43-.4.72.06 1.16l3.06 2.9c.3.29.2.62-.2.55-2.6-.46-4.6.5-4.85 2.2-.06.42-.56.45-.66.03-.42-1.8.5-3.3 2.5-4.35l-3.3-3.4c-.5-.52-.5-.95-.02-1.44l2.9-2.95c.42-.43.44-.78.1-1.26l-1.2-1.7c-.2-.3-.14-.62.05-.79z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}
