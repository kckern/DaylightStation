// Inline SVG icon set for the School home (subject wall). One coherent Solar
// (Bold) set, same pattern as Piano/PianoKiosk/icons: raw SVG strings rendered
// inline so `currentColor` inherits the tile's text color and no SVG-loader
// plugin is required.
const mods = import.meta.glob('./svg/*.svg', { eager: true, query: '?raw', import: 'default' });
const ICONS = {};
for (const [path, raw] of Object.entries(mods)) {
  const name = path.replace('./svg/', '').replace('.svg', '');
  ICONS[name] = raw;
}

/**
 * Inline SVG icon (renders with `currentColor`, sizes to `1em`).
 *
 * @param {string} name - filename (no extension) of an icon in ./svg — for
 *   subject tiles this is the subject id.
 * @param {string} [className] - extra classes appended to `school-icon`
 * @param {string} [label] - accessible label; when set the icon is role="img",
 *   otherwise it's decorative (aria-hidden) — use this when the button already
 *   carries its own aria-label.
 */
export default function Icon({ name, className, label }) {
  const svg = ICONS[name];
  if (!svg) return null;
  return (
    <span
      className={`school-icon${className ? ` ${className}` : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
