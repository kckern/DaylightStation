import crypto from 'crypto';

export function generateJwtSecret() {
  return crypto.randomBytes(64).toString('hex');
}

export function getDefaultAuthConfig() {
  return {
    roles: {
      sysadmin: { apps: ['*'] },
      admin: { apps: ['admin', 'finance', 'config', 'scheduler', 'devices', 'members'] },
      parent: { apps: ['fitness', 'finance', 'lifelog'] },
      member: { apps: ['fitness', 'lifelog'] },
      kiosk: { apps: ['tv', 'office', 'content', 'display', 'play', 'queue', 'stream', 'canvas', 'device', 'fitness', 'finance', 'lifelog'] }
    },
    household_roles: {
      default: ['kiosk']
    },
    app_routes: {
      admin: ['admin/*'],
      finance: ['finance/*'],
      config: ['config/*'],
      scheduler: ['scheduling/*'],
      fitness: ['fitness/*'],
      lifelog: ['lifelog/*'],
      tv: ['list/*', 'play/*', 'queue/*', 'stream/*'],
      office: ['display/*', 'canvas/*'],
      content: ['content/*'],
      device: ['device/*']
    },
    jwt: {
      issuer: 'daylight-station',
      expiry: '10y',
      algorithm: 'HS256'
    }
  };
}
