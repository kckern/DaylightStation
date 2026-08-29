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

/**
 * A screen URL carrying a path suffix or query is trying to launch content.
 * The boot screensaver must wait for the normal idle interval instead of
 * occupying the only fullscreen overlay slot before that launch is handled.
 */
export function hasInitialScreenAction(pathname, search = '') {
  const hasPathSuffix = /^\/screens?\/[^/]+\/.+/.test(String(pathname || ''));
  return hasPathSuffix || String(search || '').replace(/^\?/, '').length > 0;
}
