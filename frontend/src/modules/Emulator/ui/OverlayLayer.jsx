/**
 * OverlayLayer — environmental UI staged in the bezel margins.
 *
 * Each overlay declares a %-region of free bezel real-estate (heart rate,
 * cadence/RPM, current player, credit/coins, game-state meters). The host
 * supplies a `resolve(overlay) => descriptor` callback (built from
 * resolveOverlayValue + formatOverlayValue) so this layer stays presentation-
 * only and never reaches into fitness/governance/game state directly.
 *
 * A `session`-kind overlay is different: instead of one region and one
 * resolved value, it anchors to a corner (via anchorStyle) and renders
 * several named fields (player/system_label/timer/...) in one composite
 * badge, each resolved independently through `resolveField(fieldName)`.
 *
 * Empty descriptors still render a positioned (but valueless) box so the
 * dashboard layout stays stable as data comes and goes.
 */

import React from 'react';
import { regionStyle } from './regionStyle.js';
import { anchorStyle } from './anchorStyle.js';

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

function SessionOverlay({ overlay, resolveField }) {
  const fields = overlay.fields || [];
  if (fields.length === 0) return null;

  return (
    <div className="emu-overlay emu-overlay--session" data-overlay-id={overlay.id} style={anchorStyle(overlay)}>
      {fields.map((field) => {
        const d = (typeof resolveField === 'function' && resolveField(field)) || { empty: true, text: '' };
        if (d.empty) return null;
        const cls = `emu-overlay-session__field emu-overlay-session__field--${field}`
          + (d.urgency ? ` is-${d.urgency}` : '')
          + (d.stale ? ' is-stale' : '');
        return (
          <div key={field} className={cls}>
            <OverlayBody d={d} />
          </div>
        );
      })}
    </div>
  );
}

export function OverlayLayer({ overlays = [], resolve, resolveField }) {
  if (!overlays || overlays.length === 0) return null;

  return (
    <div className="emu-overlay-layer">
      {overlays.map((o) => {
        if (o.kind === 'session') {
          return <SessionOverlay key={o.id} overlay={o} resolveField={resolveField} />;
        }
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
