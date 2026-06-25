/**
 * OverlayLayer — environmental UI staged in the bezel margins.
 *
 * Each overlay declares a %-region of free bezel real-estate (heart rate,
 * cadence/RPM, current player, credit/coins, game-state meters). The host
 * supplies a `resolve(overlay) => descriptor` callback (built from
 * resolveOverlayValue + formatOverlayValue) so this layer stays presentation-
 * only and never reaches into fitness/governance/game state directly.
 *
 * Empty descriptors still render a positioned (but valueless) box so the
 * dashboard layout stays stable as data comes and goes.
 */

import React from 'react';
import { regionStyle } from './regionStyle.js';

function OverlayBody({ d }) {
  if (!d || d.empty) return null;
  if (d.kind === 'player') {
    return (
      <>
        {d.avatar ? <img className="emu-overlay__avatar" src={d.avatar} alt="" /> : null}
        <span className="emu-overlay__name">{d.name}</span>
      </>
    );
  }
  if (d.kind === 'stat') {
    return (
      <>
        <span className="emu-overlay__value">{d.text}</span>
        {d.unit ? <span className="emu-overlay__unit">{d.unit}</span> : null}
      </>
    );
  }
  return <span className="emu-overlay__value">{d.text}</span>;
}

export function OverlayLayer({ overlays = [], resolve }) {
  if (!overlays || overlays.length === 0) return null;

  return (
    <div className="emu-overlay-layer">
      {overlays.map((o) => {
        const d = (typeof resolve === 'function' && resolve(o)) || { empty: true, text: '' };
        const kind = d.empty ? 'empty' : d.kind || 'text';
        const cls = `emu-overlay emu-overlay--${kind}${d.empty ? ' is-empty' : ''}`;
        return (
          <div key={o.id} className={cls} data-overlay-id={o.id} style={regionStyle(o.region)}>
            <OverlayBody d={d} />
          </div>
        );
      })}
    </div>
  );
}

export default OverlayLayer;
