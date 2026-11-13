// iconRegistry.js — the School icon set + lookup, split out of Icon.jsx so
// Fast Refresh can hot-reload the icon component on its own.
// Two sources: authored icons tracked in ./svg, and the Solar icons generated at
// prebuild into ./svg/generated (icons.manifest.json; gitignored).
const mods = import.meta.glob(['./svg/*.svg', './svg/generated/*.svg'], { eager: true, query: '?raw', import: 'default' });

/**
 * name -> raw SVG. A TRACKED icon wins over a generated one of the same name,
 * whatever order the glob hands them over in. `writing` moved from generated
 * (Solar keyboard) to a tracked pencil on 2026-11-13, and an existing checkout
 * still holds the stale, gitignored `svg/generated/writing.svg` until its next
 * prebuild — it must not draw a keyboard over the pencil. The server's
 * `createSubjectIconResolver` reads in the same order.
 */
export function buildIconRegistry(modules) {
  const icons = {};
  const entries = Object.entries(modules ?? {});
  const generated = (path) => path.includes('/generated/');
  for (const [path, raw] of [...entries.filter(([p]) => !generated(p)), ...entries.filter(([p]) => generated(p))]) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace('.svg', '');
    if (!(name in icons)) icons[name] = raw;
  }
  return icons;
}

const ICONS = buildIconRegistry(mods);

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
