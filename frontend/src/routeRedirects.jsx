/**
 * Legacy and alias URL → canonical surface. One family, one file, because
 * every one of them fails the same silent way when it gets it wrong.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A redirect carries the QUERY STRING unless there is a stated reason not to.
 *
 * React Router's `<Navigate to="/somewhere">` with a STRING target replaces
 * the whole location, `search` included — so dropping the query is what you
 * get by DEFAULT, not what you get by mistake. That default cost us a working
 * feature: the teacher console's "Preview launch card" button 302s to
 * `/school?preview=<signed token>`, the bare `/school` redirect was a string
 * Navigate, the token was discarded, and the popup landed on the locked
 * keypad. No error, no log, no 404 — just the wrong surface. See
 * `routeRedirects.test.jsx`, which pins the query-preserving half of each of
 * these.
 *
 * They live here rather than in `main.jsx` so they can be rendered by a test
 * without importing the app bootstrap (`main.jsx` calls `createRoot().render()`
 * at module scope). A rule this easy to get silently wrong needs a seam.
 */
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Legacy `/office[/*]` → the screen-framework office screen.
 *
 * DELIBERATELY DROPS THE QUERY, unlike its siblings: the office screen takes
 * its configuration from `data/household/screens/office.yml`, not from the
 * URL, so there is no parameter here worth forwarding and a stale one would
 * be a claim about a surface that never reads it.
 */
export const OfficeRedirect = () => <Navigate to="/screen/office" replace />;

/**
 * Legacy `/tv[/*]` (the retired TVApp) → the living-room screen.
 * Preserves the query: `?queue=`, `?play=`, `?shader=` and the other autoplay
 * params are the whole point of most `/tv` links the house still holds.
 */
export const TVRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/screen/living-room${search}`} replace />;
};

/**
 * `/school[/<deep-path>]` → `/app/school[/<deep-path>]`, keeping School's own
 * segments (`subject/…`, `library/…`, `material/…`, `launch-preview/…`) intact.
 *
 * The BARE `/school` route uses this too. It has no deep path, but it does
 * carry `?preview=<signed launch-preview token>` — see the file header for
 * what happened when it had its own string-target Navigate instead.
 */
export const SchoolDeepLinkRedirect = () => {
  const { pathname, search } = useLocation();
  return <Navigate to={`/app${pathname}${search}`} replace />;
};

/**
 * `/school/teacher-next[/*]` was the rollout alias for the teacher-console
 * rebuild; the rebuild landed at `/school/teacher`. Left alone, a teacher-next
 * bookmark fell through to the `/school/*` splat and landed in the KIDS'
 * school app instead of the console — a silent wrong-surface redirect, worse
 * than the 404 it looked like it would be. Sub-path and query preserved.
 */
export const TeacherNextRedirect = () => {
  const { pathname, search } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/school\/teacher-next/, '/school/teacher')}${search}`} replace />;
};
