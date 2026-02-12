// frontend/src/lib/auth.js

const TOKEN_KEY = 'ds_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}

export function getUserApps(roleDefinitions = {}) {
  const user = getUser();
  if (!user) return [];
  const apps = new Set();
  for (const role of user.roles || []) {
    const def = roleDefinitions[role];
    if (!def) continue;
    for (const app of def.apps || []) {
      apps.add(app);
    }
  }
  return [...apps];
}

export function hasApp(appName, roleDefinitions = {}) {
  const apps = getUserApps(roleDefinitions);
  return apps.includes('*') || apps.includes(appName);
}
