// DeviceFace — a device's controls as keycaps, laid out like the device
// (deviceFaceModel). A keycap sinks and lights the moment its button is held
// (`held`), and carries a small mark once it has been pressed this visit
// (`seen`); a control never pressed is shown plain. Under each keycap, what it
// does now, in plain words. A remote drawn as mounted (`cross`) names each
// keycap by where the rider presses it, with the printed button's name small.
//
// On the device page the keycaps are not buttons (focus skips them). In the
// editor (`onPick`) each is a button: tap it, or press it, to pick it.
import React from 'react';
import { capActionLabel } from './deviceFaceModel.js';

function Cap({ cap, held, seen, picked, actionLabel, onPick }) {
  const cls = `bts-cap bts-cap--${cap.role}${held ? ' is-held' : ''}${picked ? ' is-picked' : ''}`;
  const body = (
    <>
      <span className="bts-cap-key" aria-hidden="true">
        <span className="bts-cap-legend">{cap.legend}</span>
        {cap.printed ? <span className="bts-cap-printed">{cap.printed}</span> : null}
        {seen ? <span className="bts-cap-seen" /> : null}
      </span>
      {/* A pad button with no job on these screens has no words under it. */}
      <span className="bts-cap-action">{actionLabel}</span>
    </>
  );
  const label = `${cap.legend}${actionLabel ? `: ${actionLabel}` : ''}${held ? ', pressed' : ''}${seen && !held ? ', worked' : ''}`;
  if (onPick) {
    return (
      <button type="button" className={cls} data-cap={cap.id} aria-pressed={picked} aria-label={label} data-autofocus={picked ? '' : undefined} onClick={() => onPick(cap)}>
        {body}
      </button>
    );
  }
  return <div className={cls} data-cap={cap.id} role="img" aria-label={label}>{body}</div>;
}

export function DeviceFace({ face, held, seen, savedButtons = null, groups = null, picked = null, onPick = null, labels = null, defaultFor = null }) {
  if (!face?.caps?.length) return null;
  const render = (cap) => (
    <Cap
      key={cap.id}
      cap={cap}
      held={held?.has(cap.key)}
      seen={seen?.has(cap.key)}
      picked={picked === cap.id}
      actionLabel={labels?.[cap.slot ?? cap.key] ?? capActionLabel(cap, savedButtons, groups, defaultFor)}
      onPick={onPick}
    />
  );
  const by = (role) => face.caps.filter((c) => c.role === role);
  const cross = (prefix = '') => (
    <div className={`bts-cross${prefix}`}>
      {['up', 'left', 'right', 'down'].map((d) => by(d).map(render))}
    </div>
  );

  if (face.layout === 'cross') {
    return (
      <div className="bts-face bts-face--cross" data-layout="cross">
        <div className="bts-cross bts-cross--centred">
          {['up', 'left', 'center', 'right', 'down'].map((d) => by(d).map(render))}
          {/* Which side of the remote faces the bike's front and rear. */}
          {Object.entries(face.toward || {}).map(([pos, side]) => (
            <span key={side} className={`bts-toward bts-toward--${pos}`}>{side === 'front' ? 'Front' : 'Rear'}</span>
          ))}
        </div>
      </div>
    );
  }
  if (face.layout === 'stick-pad') {
    const top = by('top');
    return (
      <div className="bts-face bts-face--stick-pad" data-layout="stick-pad">
        <div className="bts-face-main">
          {cross()}
          <div className="bts-face-side">
            {top.length ? <div className="bts-face-top">{top.map(render)}</div> : null}
            <div className="bts-pad-grid">{by('grid').map(render)}</div>
          </div>
        </div>
      </div>
    );
  }
  if (face.layout === 'pad') {
    return (
      <div className="bts-face bts-face--pad" data-layout="pad">
        <div className="bts-face-top">{by('shoulder').map(render)}</div>
        <div className="bts-face-main">
          {cross()}
          <div className="bts-pad-meta">{by('meta').map(render)}</div>
          <div className="bts-diamond">
            {['face-top', 'face-left', 'face-right', 'face-bottom'].map((r) => by(r).map(render))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`bts-face bts-face--${face.layout}`} data-layout={face.layout}>
      {face.caps.map(render)}
    </div>
  );
}

export default DeviceFace;
