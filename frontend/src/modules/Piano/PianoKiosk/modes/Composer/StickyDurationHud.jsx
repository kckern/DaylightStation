export function StickyDurationHud({ hud }) {
  const { type, dots, triplet, armed } = hud || {};
  return (
    <div className="composer-hud" role="status">
      <span className="composer-hud__duration">{type}</span>
      {dots > 0 && <span className="composer-hud__dot" aria-label="dotted">·</span>}
      {triplet && <span className="composer-hud__triplet" aria-label="triplet">3</span>}
      <span className={`composer-hud__armed${armed ? ' is-armed' : ''}`}>{armed ? 'ARMED' : 'disarmed'}</span>
    </div>
  );
}
