// frontend/src/lib/auth.js
import { subscribeToStorageKey } from './browserPreference.js';

const TOKEN_KEY = 'ds_token';
const tokenListeners = new Set();

export function subscribeToken(listener) {
  const stopStorage = subscribeToStorageKey(TOKEN_KEY, listener);
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
    stopStorage();
  };
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  for (const listener of tokenListeners) listener();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  for (const listener of tokenListeners) listener();
}

export function getUser() {
  try {
    const token = getToken();
    if (!token) return null;
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
