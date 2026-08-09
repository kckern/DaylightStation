import { useLayoutEffect } from 'react';
import { staffGroups } from '../../../../MusicNotation/renderers/osmdRender.js';

const DIM = 'is-dimmed';

/**
 * StaffDimLayer — dims DESELECTED staves by fading OSMD's own per-staff group
 * rather than covering the staff.
 *
 * The overlay this replaces painted translucent white rectangles over each
 * staff band. Musical ink is not rectangular: stems, beams, ledger lines and
 * slurs all legitimately extend past the band, so they escaped it, and the
 * band's straight edges cut across them. Fading `g.staffline` instead takes
 * every mark on that staff with it, because they are all its children.
 *
 * Group opacity composites the group ONCE rather than per element, so
 * overlapping strokes do not darken each other — the staff reads as genuinely
 * lighter ink instead of a film laid on top.
 *
 * Renders nothing, and needs no z-index: dimming the engraving itself means
 * live overlays (cursor, wet ink, note chips) are untouched, so they no longer
 * have to be stacked above a mask to avoid being muted by it.
 *
 * @param {object} p
 * @param {Element|null} p.container - the element containing the engraved <svg>.
 *   An ELEMENT, deliberately not a ref: React commits layout effects bottom-up,
 *   so an ancestor's ref is not yet attached when this child's effect first runs.
 * @param {number[]} [p.dimmed] - 0-based staff ids to dim
 * @param {unknown} [p.layoutToken] - identity changes on re-engrave; a fresh
 *   engrave replaces the SVG and with it every class set here, so the effect
 *   must re-run. Zoom, flow and transpose all force one.
 */
export default function StaffDimLayer({ container = null, dimmed = [], layoutToken = null }) {
  useLayoutEffect(() => {
    const svg = container?.querySelector?.('svg');
    if (!svg) return undefined;
    const want = new Set(dimmed);
    const touched = [];
    for (const { staff, el } of staffGroups(svg)) {
      if (!want.has(staff)) continue;
      el.classList.add(DIM);
      touched.push(el);
    }
    // Clear exactly what we set. The SVG outlives this component across mode
    // changes, so leaving the class behind would strand a dimmed staff.
    return () => { for (const el of touched) el.classList.remove(DIM); };
  }, [container, dimmed, layoutToken]);

  return null;
}
