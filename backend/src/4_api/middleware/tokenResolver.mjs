// backend/src/4_api/middleware/tokenResolver.mjs
import { verifyToken } from '#system/auth/jwt.mjs';

export function tokenResolver({ jwtSecret, jwtConfig }) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
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
