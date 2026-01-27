// backend/src/4_api/middleware/householdResolver.mjs

/**
 * Middleware that resolves household from request host.
 * Uses explicit domain mapping first, then pattern matching, then default.
 */
export function householdResolver({ domainConfig, configService }) {
  const explicitMap = domainConfig.domain_mapping || {};
  const patterns = domainConfig.patterns || [];

  return (req, res, next) => {
    const host = req.headers.host || '';

    // 1. Check explicit mapping
    if (explicitMap[host]) {
      req.householdId = explicitMap[host];
    }
    // 2. Try pattern matching
    else {
      req.householdId = matchPatterns(host, patterns) || 'default';
    }

    // 3. Validate household exists
    if (!configService.householdExists(req.householdId)) {
      return res.status(404).json({
        error: 'Household not found',
        household: req.householdId,
      });
    }

    // 4. Attach household context
    req.household = configService.getHousehold?.(req.householdId);

    next();
  };
}

/**
 * Match host against regex patterns to extract household.
 */
export function matchPatterns(host, patterns) {
  for (const { regex } of patterns) {
    const match = host.match(new RegExp(regex));
    if (match?.groups?.household) {
      return match.groups.household;
    }
  }
  return null;
}
