// backend/src/0_system/routing/RouteMatcher.mjs

/**
 * Build routing table from config, sorted by path length (longest first)
 * @param {Object} routing - Map of path to target config
 * @returns {Array} Sorted routing table entries
 */
export function buildRoutingTable(routing) {
  const entries = Object.entries(routing).map(([path, rule]) => {
    const target = typeof rule === 'string' ? rule : rule.target;
    return { path, target };
  });

  // Sort by path length descending (longest prefix first)
  entries.sort((a, b) => b.path.length - a.path.length);

  return entries;
}

/**
 * Match request path against routing table
 * @param {string} requestPath - Incoming request path
 * @param {Array} routingTable - Sorted routing table
 * @param {string} defaultTarget - Default target if no match ('legacy' or 'new')
 * @returns {Object} { target, matched }
 */
export function matchRoute(requestPath, routingTable, defaultTarget) {
  for (const entry of routingTable) {
    if (requestPath === entry.path || requestPath.startsWith(entry.path + '/')) {
      return {
        target: entry.target,
        matched: entry.path,
      };
    }
  }

  return {
    target: defaultTarget,
    matched: null,
  };
}
