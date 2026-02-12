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
    const ip = req.ip || '';
    const local = isPrivateIp(ip);
    req.isLocal = local;

    if (local && req.householdId) {
      req.roles = [...(householdRoles[req.householdId] || [])];
    } else {
      req.roles = [];
    }

    next();
  };
}
