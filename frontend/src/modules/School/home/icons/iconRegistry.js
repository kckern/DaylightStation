// iconRegistry.js — the School icon set + lookup, split out of Icon.jsx so
// Fast Refresh can hot-reload the icon component on its own.
const mods = import.meta.glob('./svg/*.svg', { eager: true, query: '?raw', import: 'default' });
const ICONS = {};
for (const [path, raw] of Object.entries(mods)) {
  const name = path.replace('./svg/', '').replace('.svg', '');
  ICONS[name] = raw;
}

/**
 * True when `name` resolves to a real file in ./svg.
 *
 * `Icon` renders NOTHING for an unknown name, which is the right default for a
 * decorative chip but wrong wherever the icon IS the content — a status pill
 * would come out as an empty disc with no way to tell why. Callers that must
 * always draw something ask first and substitute their own fallback.
 */
export function hasIcon(name) {
  return Boolean(name && ICONS[name]);
}

export default ICONS;
