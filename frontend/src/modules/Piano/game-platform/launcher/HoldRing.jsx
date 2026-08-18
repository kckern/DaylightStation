import './NoteLauncher.scss';

/**
 * The brass ring that fills while the player holds the combo down, and at
 * `holdMs` drops them back to free-play.
 *
 * A sibling of the launcher rather than a child. Holding the combo while the
 * launcher is OPEN toggles it shut and then force-quits at 2s — a ring living
 * inside the overlay would disappear at exactly the moment the player needs to
 * see that holding is doing something.
 */
export default function HoldRing({ holdMs = 2000 }) {
  return <div className="nl-hold" style={{ animationDuration: `${holdMs}ms` }} aria-hidden="true" />;
}
