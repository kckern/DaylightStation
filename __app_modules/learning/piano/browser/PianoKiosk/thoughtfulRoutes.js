// thoughtfulRoutes.js — where an idle timeout must not end what is on screen.
//
// A player reading a score, weighing a chess move or working a drill can sit
// for minutes without touching a key: that is the activity, not absence. On
// these routes idle leaves the screen where it is (the screen may still sleep;
// the work is kept). Passive and free-play routes (menu, videos, music, studio)
// keep their idle return.
const THOUGHTFUL = Object.freeze(['sheetmusic', 'games', 'exercises', 'composer', 'producer', 'placement']);

/** True when `pathname`, under this piano's `basePath`, is a thoughtful route. */
export function isThoughtfulRoute(pathname, basePath) {
  if (typeof pathname !== 'string' || typeof basePath !== 'string') return false;
  const base = basePath.replace(/\/$/, '');
  return THOUGHTFUL.some((segment) => {
    const root = `${base}/${segment}`;
    return pathname === root || pathname.startsWith(`${root}/`);
  });
}

export default isThoughtfulRoute;
