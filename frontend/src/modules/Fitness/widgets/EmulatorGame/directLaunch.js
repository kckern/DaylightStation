// directLaunch.js — resolve a /fitness/games/:system/:game deep link to a
// library game.
//
// The link is for testing: it opens a game with no admin gate, so a render can
// be checked headlessly or from any browser. The game segment is matched
// loosely against id and title (case, spaces, dashes and punctuation ignored),
// so `SuperMarioLand`, `super-mario-land` and `Super Mario Land` all find
// `super-mario-land` — and none of them find `super-mario-land-2`.

/** Lowercase alphanumerics only. */
export function slugKey(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/**
 * Parse the path remainder after `/fitness/games/`.
 * @param {string|null} id - e.g. 'gb/SuperMarioLand'
 * @returns {{system:string, game:string|null}|null}
 */
export function parseDirectLaunch(id) {
  if (!id) return null;
  const [system, ...rest] = String(id).split('/').map((s) => decodeURIComponent(s).trim()).filter(Boolean);
  if (!system) return null;
  return { system, game: rest.join('/') || null };
}

/**
 * @param {Array<{id:string,system:string,title?:string}>} games
 * @param {{system:string, game:string|null}} target
 * @returns {object|null} the matching game, or null
 */
export function findDirectLaunchGame(games, target) {
  if (!target?.system || !target?.game) return null;
  const system = slugKey(target.system);
  const want = slugKey(target.game);
  if (!want) return null;
  const onSystem = (games || []).filter((g) => slugKey(g.system) === system);
  return onSystem.find((g) => slugKey(g.id) === want)
    || onSystem.find((g) => slugKey(g.title) === want)
    || null;
}
