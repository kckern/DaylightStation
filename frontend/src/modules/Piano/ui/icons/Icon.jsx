// Inline SVG icon set for the Piano Kiosk. One coherent Solar (Bold) set.
// Icons are loaded as raw SVG strings and rendered inline so `currentColor`
// inherits the button's text color and no SVG-loader plugin is required.
const mods = import.meta.glob('./svg/*.svg', { eager: true, query: '?raw', import: 'default' });
const ICONS = {};
for (const [path, raw] of Object.entries(mods)) {
  const name = path.replace('./svg/', '').replace('.svg', '');
  ICONS[name] = raw;
}

/**
 * Inline SVG icon (renders with `currentColor`, sizes to `1em`).
 *
 * @param {string} name - filename (no extension) of an icon in ./svg
 * @param {string} [className] - extra classes appended to `piano-icon`
 * @param {string} [label] - accessible label; when set the icon is role="img",
 *   otherwise it's decorative (aria-hidden) — use this when the button already
 *   carries its own aria-label.
 */
export default function Icon({ name, className, label }) {
  const svg = ICONS[name];
  if (!svg) return null;
  return (
    <span
      className={`piano-icon${className ? ` ${className}` : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
