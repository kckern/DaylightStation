// Keyboard / gamepad focus model for the settings menu. Up/Down walk the
// controls in DOM order (= visual order, top to bottom). A row of related
// buttons (the 11-step volume strip, the boost segments) is ONE stop; Left and
// Right move within it.
const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';
const ROW = '.touch-volume, .volume-boost-controls';

export function menuFocusStops(root) {
  if (!root) return [];
  const stops = [];
  const seenRows = new Set();
  for (const el of root.querySelectorAll(FOCUSABLE)) {
    if (el.closest('[role="dialog"]')) continue;
    const row = el.closest(ROW);
    if (!row) { stops.push(el); continue; }
    if (seenRows.has(row)) continue;
    seenRows.add(row);
    const buttons = [...row.querySelectorAll(FOCUSABLE)];
    stops.push(buttons.find((b) => b.getAttribute('aria-pressed') === 'true') || buttons[0]);
  }
  return stops;
}

export function nextFocusStop(stops, active, step) {
  if (!stops.length) return null;
  const row = active?.closest?.(ROW);
  let index = stops.indexOf(active);
  if (index < 0 && row) index = stops.findIndex((s) => row.contains(s));
  if (index < 0) return step < 0 ? stops[stops.length - 1] : stops[0];
  const next = index + step;
  return next >= 0 && next < stops.length ? stops[next] : null;
}

// Left/Right inside a row: the neighbouring segment, or null at either end.
export function rowNeighbour(active, step) {
  const row = active?.closest?.(ROW);
  if (!row) return null;
  const buttons = [...row.querySelectorAll(FOCUSABLE)];
  const index = buttons.indexOf(active);
  return index < 0 ? null : (buttons[index + step] || null);
}
