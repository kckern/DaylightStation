// backend/src/4_api/middleware/tokenResolver.mjs
import { verifyToken } from '#system/auth/jwt.mjs';

export const SESSION_COOKIE = 'daylight_session';

/**
 * One cookie, read without a parser. `cookie-parser` is a dependency but is
 * mounted nowhere, and `school.mjs` already hand-rolls this for the teacher
 * cookie — matching it rather than introducing a second convention.
 */
function cookieValue(req, name) {
  const raw = req.headers?.cookie ?? '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function tokenResolver({ jwtSecret, jwtConfig }) {
  return (req, res, next) => {
    // Header first, cookie second. A CLI or the agent mounts send a Bearer
    // token; a browser cannot attach one to an ordinary navigation or fetch
    // without carrying it in JS, which is why one sign-in never covered the
    // other adult apps. The cookie is the same token on a different transport,
    // HttpOnly so no script — ours or anyone's — can read it back out.
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookieValue(req, SESSION_COOKIE);
    if (!token) {
      return next();
    }

    const payload = verifyToken(token, jwtSecret, {
      issuer: jwtConfig.issuer,
      algorithms: [jwtConfig.algorithm]
    });

    if (!payload) {
      return next();
    }

    req.user = {
      sub: payload.sub,
      hid: payload.hid,
      roles: payload.roles || []
    };

    // Merge token roles into existing roles (from networkTrustResolver), deduplicated
    const merged = new Set([...(req.roles || []), ...req.user.roles]);
    req.roles = [...merged];

    next();
  };
}
