export function createDefaultAuthenticationConfiguration(jwtSecret) {
  return {
    roles: {
      sysadmin: { apps: ['*'] },
      admin: { apps: ['admin', 'finance', 'config', 'scheduler', 'devices', 'members', 'state-gates'] },
      parent: { apps: ['fitness', 'finance', 'lifelog', 'state-gates'] },
      member: { apps: ['fitness', 'lifelog', 'state-gates'] },
      kiosk: { apps: ['tv', 'office', 'content', 'display', 'play', 'queue', 'stream', 'canvas', 'device', 'fitness', 'finance', 'lifelog', 'state-gates'] },
    },
    household_roles: {
      default: ['kiosk'],
    },
    app_routes: {
      admin: ['admin/*', 'pressure-mats/*'],
      finance: ['finance/*'],
      config: ['config/*'],
      scheduler: ['scheduling/*'],
      fitness: ['fitness/*'],
      lifelog: ['lifelog/*'],
      tv: ['list/*', 'play/*', 'queue/*', 'stream/*'],
      office: ['display/*', 'canvas/*'],
      content: ['content/*'],
      device: ['device/*'],
      'state-gates': ['state-gates/*', 'entitlements/*'],
    },
    jwt: {
      issuer: 'daylight-station',
      expiry: '10y',
      algorithm: 'HS256',
      secret: jwtSecret,
    },
  };
}

/**
 * Preserve authored authentication configuration while ensuring the new
 * State Gates routes are never left unmapped (unmapped routes are public in
 * permissionGate). Existing households pick this up before their YAML is next
 * saved through the admin surface.
 */
export function withStateGatesAuthenticationConfiguration(configuration = {}) {
  const roles = Object.fromEntries(Object.entries(configuration.roles ?? {}).map(([id, definition]) => {
    const apps = [...new Set(definition.apps ?? [])];
    if (['admin', 'parent', 'member', 'kiosk'].includes(id)) apps.push('state-gates');
    return [id, { ...definition, apps: [...new Set(apps)] }];
  }));
  return {
    ...configuration,
    roles,
    app_routes: {
      ...(configuration.app_routes ?? {}),
      'state-gates': ['state-gates/*', 'entitlements/*'],
    },
  };
}
