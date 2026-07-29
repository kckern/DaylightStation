import React from 'react';

/**
 * StaffDimLayer — translucent paper mask over DESELECTED staves (wave-3 A).
 * Sits UNDER the range tint and cursor (z2 < tint z3 < cursor z5), so active
 * overlays — including wrong-note wet ink — always render at full strength
 * above it. Pure: geometry in, absolutely-positioned divs out.
 */
const PAD_UNITS = 1.5; // ledger territory above the first / below the last staff

export function dimBands(staffBoxes = [], dimmed = []) {
  if (!staffBoxes.length || !dimmed.length) return [];
  const want = new Set(dimmed);
  const bySystem = new Map();
  for (const b of staffBoxes) {
    if (!bySystem.has(b.system)) bySystem.set(b.system, []);
    bySystem.get(b.system).push(b);
  }
  const bands = [];
  for (const staves of bySystem.values()) {
    staves.sort((a, b) => a.top - b.top);
    staves.forEach((s, i) => {
      if (!want.has(s.staff)) return;
      const bottom = s.top + s.lineSpacing * 4;
      const prev = staves[i - 1];
      const next = staves[i + 1];
      const top = prev ? (prev.top + prev.lineSpacing * 4 + s.top) / 2 : s.top - s.lineSpacing * PAD_UNITS;
      const end = next ? (bottom + next.top) / 2 : bottom + s.lineSpacing * PAD_UNITS;
      bands.push({ left: s.left, top, width: s.right - s.left, height: end - top });
    });
  }
  return bands;
}

export default function StaffDimLayer({ staffBoxes = [], dimmed = [] }) {
  return (
    <>
      {dimBands(staffBoxes, dimmed).map((b, i) => (
        <div key={i} className="piano-score-staff-dim" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
      ))}
    </>
  );
}
