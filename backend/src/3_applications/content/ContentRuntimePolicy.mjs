export const LEGACY_CONTENT_ALIASES = Object.freeze({
  local: 'watchlist:',
  singing: 'singalong:',
  narrated: 'readalong:',
  list: 'menu:',
});

export const CONTENT_SEARCH_BUDGET = Object.freeze({
  adapterTimeoutMs: 3000,
  sourceTimeoutsMs: Object.freeze({
    plex: 10000,
    abs: 6000,
    singalong: 8000,
    readalong: 6000,
    'local-content': 6000,
    files: 5000,
  }),
});

export function buildBareContentNameMap(nameCatalog) {
  const aliases = {};
  for (const [prefix, listType] of [['watchlist', 'watchlists'], ['program', 'programs'], ['menu', 'menus']]) {
    for (const name of nameCatalog?.listNames(listType) || []) aliases[name] = prefix;
  }
  return aliases;
}
