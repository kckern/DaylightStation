/**
 * Resolve a screen URL suffix as a registered app plus an optional app-owned
 * path. Registration is injected to keep this parser independent of React and
 * the app registry implementation.
 */
export function resolveScreenAppPath(pathname, hasApp, routes = {}) {
  const match = String(pathname || '').match(/^\/screens?\/[^/]+\/(.+)$/);
  if (!match) return null;

  const segments = match[1].split('/').filter(Boolean);
  const routeName = segments[0];
  const configuredApp = routes?.[routeName]?.app;
  // Preserve legacy one-segment app links. Nested app-owned paths are a
  // surface capability and must be mounted explicitly in screen config.
  const appId = configuredApp || (segments.length === 1 ? routeName : null);
  if (!appId || !hasApp(appId)) return null;

  const appPath = segments.slice(1).join('/') || null;
  return {
    appId,
    appPath,
    menuId: appPath ? `${appId}/${appPath}` : appId,
  };
}
