/**
 * iso -> bundled flag SVG url. Lazy `?url` (not raw-inlined) so ~50 flag SVGs
 * don't bloat the main bundle. Source: lipis/flag-icons (MIT) — see flags/README.md.
 */
const URLS = import.meta.glob('./flags/*.svg', { eager: true, query: '?url', import: 'default' });
const BY_ISO = {};
for (const [path, url] of Object.entries(URLS)) {
  const iso = path.replace('./flags/', '').replace('.svg', '').toUpperCase();
  BY_ISO[iso] = url;
}

export function flagFor(iso) {
  if (!iso) return null;
  return BY_ISO[String(iso).toUpperCase()] || null;
}

export default flagFor;
