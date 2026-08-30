export function createDefaultAuthenticationConfiguration(jwtSecret) {
  return {
    roles: {
      sysadmin: { apps: ['*'] },
      admin: { apps: ['admin', 'finance', 'config', 'scheduler', 'devices', 'members', 'requirements'] },
      parent: { apps: ['fitness', 'finance', 'lifelog', 'requirements'] },
      member: { apps: ['fitness', 'lifelog', 'requirements'] },
      kiosk: { apps: ['tv', 'office', 'content', 'display', 'play', 'queue', 'stream', 'canvas', 'device', 'fitness', 'finance', 'lifelog', 'requirements'] },
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
      requirements: ['requirements/*', 'entitlements/*'],
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
 * Requirements routes are never left unmapped (unmapped routes are public in
 * permissionGate). Existing households pick this up before their YAML is next
 * saved through the admin surface.
 */
export function withRequirementsAuthenticationConfiguration(configuration = {}) {
  const roles = Object.fromEntries(Object.entries(configuration.roles ?? {}).map(([id, definition]) => {
    const apps = [...new Set(definition.apps ?? [])];
    if (['admin', 'parent', 'member', 'kiosk'].includes(id)) apps.push('requirements');
    return [id, { ...definition, apps: [...new Set(apps)] }];
  }));
  return {
    ...configuration,
    roles,
    app_routes: {
      ...(configuration.app_routes ?? {}),
      requirements: ['requirements/*', 'entitlements/*'],
    },
  };
}
