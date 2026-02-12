// backend/src/4_api/middleware/permissionGate.mjs

export function expandRolesToApps(userRoles, roleDefinitions) {
  const apps = new Set();
  for (const role of userRoles) {
    const def = roleDefinitions[role];
    if (!def) continue;
    for (const app of def.apps) {
      apps.add(app);
    }
  }
  return [...apps];
}

export function resolveRouteApp(routePath, appRoutes) {
  // Strip leading slash for matching
  const path = routePath.replace(/^\//, '');
  for (const [app, patterns] of Object.entries(appRoutes)) {
    for (const pattern of patterns) {
      // Convert 'admin/*' to regex that matches 'admin/anything'
      const prefix = pattern.replace(/\/\*$/, '');
      if (path === prefix || path.startsWith(prefix + '/')) {
        return app;
      }
    }
  }
  return null;
}

export function permissionGate({ roles, appRoutes }) {
  return (req, res, next) => {
    const app = resolveRouteApp(req.path, appRoutes);

    // Unmapped routes are unrestricted
    if (!app) return next();

    const userApps = expandRolesToApps(req.roles || [], roles);

    // Wildcard access (sysadmin)
    if (userApps.includes('*')) return next();

    // Check if user has access to this app
    if (userApps.includes(app)) return next();

    // Denied — 401 if no user identity, 403 if authenticated but insufficient
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}
