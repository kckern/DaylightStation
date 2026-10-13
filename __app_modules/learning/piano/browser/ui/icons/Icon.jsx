// Inline SVG icon set shared across the Piano app — the kiosk, the games, and
// the office-screen surfaces. One coherent Solar (Bold) set.
// Icons are loaded as raw SVG strings and rendered inline so `currentColor`
// inherits the button's text color and no SVG-loader plugin is required.
// Two sources: authored icons tracked in ./svg, and the Solar icons generated
// at prebuild into ./svg/generated (icons.manifest.json; gitignored).
const mods = import.meta.glob(['./svg/*.svg', './svg/generated/*.svg'], { eager: true, query: '?raw', import: 'default' });
export const ICONS = {};
for (const [path, raw] of Object.entries(mods)) {
  const name = path.slice(path.lastIndexOf('/') + 1).replace('.svg', '');
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
       
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
