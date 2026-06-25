/**
 * HotspotLayer — interactive bezel engravings.
 *
 * Renders one transparent, focusable button per *actionable* hotspot (those with
 * an `action` verb or a `do:` block), positioned by its %-region over the
 * full-bleed chrome. Decorative-only hotspots (no action/do) are skipped — they
 * are documented in the manifest for tuning but produce no interaction target.
 *
 * Activation model: pointer/tap (per design). The button is keyboard-focusable
 * too, so a remote/gamepad that can move DOM focus also works for free.
 */

import React from 'react';
import { regionStyle } from './regionStyle.js';

function isActionable(h) {
  return !!(h && (h.action || h.do));
}

export function HotspotLayer({ hotspots = [], onActivate }) {
  const actionable = hotspots.filter(isActionable);
  if (actionable.length === 0) return null;

  return (
    <div className="emu-hotspot-layer">
      {actionable.map((h) => (
        <button
          key={h.id}
          type="button"
          className="emu-hotspot"
          data-hotspot-id={h.id}
          aria-label={h.label || h.id}
          style={regionStyle(h.region)}
          onClick={() => onActivate?.(h)}
        />
      ))}
    </div>
  );
}

export default HotspotLayer;
