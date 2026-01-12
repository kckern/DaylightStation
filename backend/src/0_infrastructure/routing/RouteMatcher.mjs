// backend/src/0_infrastructure/routing/RouteMatcher.mjs

/**
 * Build routing table from config, sorted by path length (longest first)
 * @param {Object} routing - Map of path to target/shim config
 * @returns {Array} Sorted routing table entries
 */
export function buildRoutingTable(routing) {
  const entries = Object.entries(routing).map(([path, rule]) => {
    const target = typeof rule === 'string' ? rule : rule.target;
    const shim = typeof rule === 'object' ? rule.shim : null;
    return { path, target, shim };
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
 * @returns {Object} { target, shim, matched }
 */
export function matchRoute(requestPath, routingTable, defaultTarget) {
  for (const entry of routingTable) {
    if (requestPath === entry.path || requestPath.startsWith(entry.path + '/')) {
      return {
        target: entry.target,
        shim: entry.shim,
        matched: entry.path,
      };
    }
  }

  return {
    target: defaultTarget,
    shim: null,
    matched: null,
  };
}
