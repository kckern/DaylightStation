/**
 * Strava OAuth + API client, shared by every `strava` subcommand.
 *
 * Before consolidation this refresh-and-persist logic existed in three
 * independent copies (`strava.cli.mjs`, `scripts/backfill-strava-calories.mjs`,
 * `scripts/session-to-strava.mjs`), each able to drift from the others and
 * from `StravaClientAdapter`. This is the single copy.
 *
 * Auth files (read, and written back on refresh):
 *   data/system/auth/strava.yml        client_id, client_secret
 *   data/users/{user}/auth/strava.yml  refresh, access_token, expires_at
 *
 * @module cli/lib/fitness/stravaAuth
 */

import path from 'path';
import { CliError } from './context.mjs';

export const STRAVA_BASE = 'https://www.strava.com';

/**
 * Resolve the two auth-file paths for a user.
 *
 * @param {Object} ctx - from `getContext()`
 * @param {string} [username] - defaults to `ctx.username`
 * @returns {{systemAuthPath: string, userAuthBase: string, userAuthPath: string, username: string}}
 */
export function authPaths(ctx, username = ctx.username) {
  const userAuthBase = path.join(ctx.dataDir, 'users', username, 'auth', 'strava');
  return {
    username,
    systemAuthPath: path.join(ctx.dataDir, 'system', 'auth', 'strava.yml'),
    userAuthBase, // saveYaml appends .yml
    userAuthPath: `${userAuthBase}.yml`,
  };
}

/**
 * @param {Object} ctx
 * @param {string} [username]
 * @returns {{client_id: string|number, client_secret: string}}
 */
export function loadSystemAuth(ctx, username) {
  const { systemAuthPath } = authPaths(ctx, username);
  const data = ctx.loadYamlSafe(systemAuthPath);
  if (!data?.client_id || !data?.client_secret) {
    throw new CliError(`Strava system auth missing client_id/client_secret at ${systemAuthPath}`);
  }
  return data;
}

/**
 * @param {Object} ctx
 * @param {string} [username]
 * @returns {{refresh: string, access_token?: string, expires_at?: number, updated_at?: string}}
 */
export function loadUserAuth(ctx, username) {
  const { userAuthBase, userAuthPath } = authPaths(ctx, username);
  const data = ctx.loadYamlSafe(userAuthBase);
  if (!data?.refresh) {
    throw new CliError(`User auth missing refresh token at ${userAuthPath}`);
  }
  return data;
}

/**
 * Return a valid access token, refreshing and persisting it when the stored
 * one is within 60s of expiry (or when `force` is set).
 *
 * @param {Object} ctx
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false]
 * @param {string} [opts.username]
 * @returns {Promise<{refresh: string, access_token: string, expires_at: number, updated_at: string}>}
 */
export async function refreshIfNeeded(ctx, { force = false, username } = {}) {
  const auth = loadUserAuth(ctx, username);
  const now = Math.floor(Date.now() / 1000);

  if (!force && auth.access_token && auth.expires_at && now < auth.expires_at - 60) {
    return auth;
  }

  const sys = loadSystemAuth(ctx, username);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh,
    client_id: String(sys.client_id),
    client_secret: sys.client_secret,
  });

  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new CliError(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const updated = {
    refresh: data.refresh_token || auth.refresh,
    access_token: data.access_token,
    expires_at: data.expires_at,
    updated_at: new Date().toISOString(),
  };

  const { userAuthBase } = authPaths(ctx, username);
  ctx.saveYaml(userAuthBase, updated);
  return updated;
}

/**
 * Call the Strava v3 API with a fresh token. Returns parsed JSON (or raw text
 * for non-JSON responses, or `null` for 204).
 *
 * @param {Object} ctx
 * @param {string} endpoint - path below `/api/v3`, e.g. `/athlete/activities?...`
 * @param {Object} [opts] - fetch options; `opts.username` selects the auth file
 * @returns {Promise<any>}
 */
export async function stravaApi(ctx, endpoint, opts = {}) {
  const { username, ...fetchOpts } = opts;
  const auth = await refreshIfNeeded(ctx, { username });

  const res = await fetch(`${STRAVA_BASE}/api/v3${endpoint}`, {
    ...fetchOpts,
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      ...(fetchOpts.headers || {}),
    },
  });

  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    throw new CliError(`${fetchOpts.method || 'GET'} ${endpoint} failed (${res.status}):\n${detail}`);
  }

  return body;
}

/**
 * Shorthand for callers that need to drive `fetch` themselves (multipart
 * uploads, streaming) but still want the shared refresh behavior.
 *
 * @param {Object} ctx
 * @param {Object} [opts]
 * @returns {Promise<string>}
 */
export async function getAccessToken(ctx, opts = {}) {
  const auth = await refreshIfNeeded(ctx, opts);
  return auth.access_token;
}
