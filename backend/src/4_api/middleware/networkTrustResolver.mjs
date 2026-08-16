// backend/src/4_api/middleware/networkTrustResolver.mjs

const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8
  /^::1$/,                          // IPv6 loopback
  /^::ffff:127\./,                  // IPv4-mapped loopback
  /^::ffff:10\./,                   // IPv4-mapped 10.x
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./, // IPv4-mapped 172.16-31.x
  /^::ffff:192\.168\./              // IPv4-mapped 192.168.x
];

function isPrivateIp(ip) {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

export function networkTrustResolver({ householdRoles }) {
  return (req, res, next) => {
    // The SOCKET PEER, deliberately, not `req.ip`.
    //
    // This used to read `req.ip`, which was the socket peer because
    // `trust proxy` had never been set. Setting it (2026-08-16, so backend logs
    // can name a client) redefines `req.ip` as an X-Forwarded-For–derived
    // address — and this line grants `sysadmin` to any private address. Leaving
    // it on `req.ip` would therefore have changed who holds sysadmin as a side
    // effect of a logging change, in both directions: remote household members
    // would lose it, and a spoofed header could become an input to it.
    //
    // Pinning to the peer keeps the trust boundary exactly where it was. It
    // also preserves the pre-existing problem that any caller arriving through
    // the reverse proxy presents a private peer and is trusted — real, and out
    // of scope for an observability change. Fixing it is a deliberate decision
    // about who may reach the house from outside, not a side effect.
    const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || '';
    const local = isPrivateIp(ip);
    req.isLocal = local;

    if (local) {
      req.roles = ['sysadmin', ...(householdRoles[req.householdId] || [])];
    } else {
      req.roles = [];
    }

    next();
  };
}
