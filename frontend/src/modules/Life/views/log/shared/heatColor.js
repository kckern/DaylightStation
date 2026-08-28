// heatColor.js — count-to-color scale for ActivityHeatmap.jsx, split out so
// Fast Refresh can hot-reload the heatmap component on its own.

export function getHeatColor(count, max) {
  if (count === 0) return 'var(--mantine-color-dark-4)';
  const ratio = max ? count / max : 0;
  if (ratio > 0.75) return 'var(--mantine-color-green-6)';
  if (ratio > 0.5) return 'var(--mantine-color-green-5)';
  if (ratio > 0.25) return 'var(--mantine-color-green-4)';
  return 'var(--mantine-color-green-3)';
}
