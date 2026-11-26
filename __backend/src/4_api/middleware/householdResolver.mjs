// __backend/src/4_api/middleware/householdResolver.mjs

/**
 * Middleware that resolves household from request host.
 * Uses explicit domain mapping first, then pattern matching, then default.
 */
export function householdResolver({ domainConfig, householdContext, observe = null }) {
  const explicitMap = domainConfig.domain_mapping || {};
  const patterns = domainConfig.patterns || [];

  return (req, res, next) => {
    const host = req.headers.host || '';

    const exact = explicitMap[host];
    const pattern = exact ? null : matchPatterns(host, patterns);
    req.householdId = exact || pattern || householdContext.resolve();
    if (observe) {
      req.accessObservation = {
        resolution: exact ? 'exact' : pattern ? 'pattern' : 'fallback',
        householdId: req.householdId ?? null,
      };
      observe({ host, ...req.accessObservation });
    }

    // 3. Validate household exists
    if (!householdContext.exists(req.householdId)) {
      return res.status(404).json({
        error: 'Household not found',
        household: req.householdId,
      });
    }

    // 4. Attach household context
    req.household = householdContext.household(req.householdId);

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
