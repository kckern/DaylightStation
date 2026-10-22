// Card size for the sidebar rider list, chosen by fit rather than by rider
// count: the largest size whose list fits the room. Past compact the list
// scrolls; it is never shrunk with a transform, which scaled text below what a
// rider can read from the bike.
export const DENSITIES = ['roomy', 'comfortable', 'regular', 'compact'];

const CLASS_BY_DENSITY = {
  roomy: 'horiz-scale-150',
  comfortable: 'horiz-scale-130',
  regular: '',
  compact: 'density-compact',
};
const DENSITY_CLASSES = Object.values(CLASS_BY_DENSITY).filter(Boolean);

export function densityClassName(density) {
  return CLASS_BY_DENSITY[density] ?? '';
}

// Try each size on the live DOM (grid class + compact card class), measure,
// and put the DOM back. Done inside a layout effect, so nothing paints between
// trials and React renders only the chosen size — no intermediate commits for
// the list's FLIP animation to chase.
export function pickDensity(container, content) {
  const grid = content?.querySelector?.('.device-grid');
  if (!container || !grid) return DENSITIES[0];
  const cards = [...grid.querySelectorAll('.fitness-device.card-horizontal')];
  const originalClass = grid.className;
  const originalCompact = cards.map((card) => card.classList.contains('card-compact'));
  const baseClasses = originalClass.split(/\s+/).filter((c) => c && !DENSITY_CLASSES.includes(c));
  const room = container.clientHeight + 1;
  let chosen = DENSITIES[DENSITIES.length - 1];
  try {
    for (const density of DENSITIES) {
      grid.className = [...baseClasses, densityClassName(density)].filter(Boolean).join(' ');
      cards.forEach((card) => card.classList.toggle('card-compact', density === 'compact'));
      if (content.scrollHeight <= room) {
        chosen = density;
        break;
      }
    }
  } finally {
    grid.className = originalClass;
    cards.forEach((card, i) => card.classList.toggle('card-compact', originalCompact[i]));
  }
  return chosen;
}
