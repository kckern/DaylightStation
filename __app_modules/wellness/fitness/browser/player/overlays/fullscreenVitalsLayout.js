/** Fit fixed square cells into the actual player's corner, never scaling up. */
export function fullscreenVitalsLayout({ width, height, heartRates = 0, equipment = 0 }) {
  const cell = 88;
  const gap = 8;
  const maxWidth = Math.max(0, Math.min(320, width * 0.3));
  const maxHeight = Math.max(0, height * 0.55);
  const count = heartRates + equipment;
  if (!count) return { columns: 1, rows: 0, width: 0, height: 0, scale: 0 };
  let best = null;
  for (let columns = 1; columns <= Math.min(4, Math.max(heartRates, equipment)); columns += 1) {
    const rows = Math.ceil(heartRates / columns) + Math.ceil(equipment / columns);
    const candidateWidth = columns * cell + (columns - 1) * gap;
    const candidateHeight = rows * cell + (rows - 1) * gap;
    const scale = Math.min(1, maxWidth / candidateWidth, maxHeight / candidateHeight);
    if (!best || scale > best.scale) best = { columns, rows, width: candidateWidth, height: candidateHeight, scale };
  }
  return best;
}
