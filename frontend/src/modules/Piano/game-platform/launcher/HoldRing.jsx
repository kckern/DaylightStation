import './NoteLauncher.scss';

/**
 * The ring that fills while the player holds the combo down, and at `holdMs`
 * drops them back to free-play.
 *
 * Drawn as an SVG arc, NOT a conic-gradient on a registered `@property`. That
 * version relied on `@property --nl-hold-turn` interpolating an angle, and where
 * the registration does not take, the gradient cannot animate at all — the ring
 * showed as a solid dark disc for the whole hold and then vanished, which tells
 * the player nothing about how long they have held or how much is left.
 * `stroke-dashoffset` on a circle is plain SVG: it animates everywhere, and it
 * degrades to a static ring rather than to a black lump.
 *
 * A sibling of the launcher rather than a child. Holding the combo while the
 * launcher is OPEN toggles it shut and then force-quits at 2s — a ring living
 * inside the overlay would disappear at exactly the moment the player needs to
 * see that holding is doing something.
 */
export default function HoldRing({ holdMs = 2000 }) {
  return (
    <div className="nl-hold" aria-hidden="true">
      <svg className="nl-hold__svg" viewBox="0 0 100 100">
        {/* The track it fills against — without it the arc has no context and a
            quarter-turn reads as an accident rather than as one quarter. */}
        <circle className="nl-hold__track" cx="50" cy="50" r="44" />
        <circle
          className="nl-hold__arc"
          cx="50" cy="50" r="44"
          style={{ animationDuration: `${holdMs}ms` }}
        />
      </svg>
      <span className="nl-hold__label">HOLD TO QUIT</span>
    </div>
  );
}
