import { execSync } from 'node:child_process';

export function readBuxferCredsDirect({ env = process.env, dockerExec = null } = {}) {
  if (env.BUXFER_EMAIL && env.BUXFER_PASSWORD) {
    return { email: env.BUXFER_EMAIL, password: env.BUXFER_PASSWORD };
  }
  const exec = dockerExec || (() => execSync(
    `sudo docker exec daylight-station sh -c 'cat data/household/auth/buxfer.yml'`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim());

  let raw;
  try { raw = exec(); }
  catch (err) {
    throw new Error(
      'Buxfer credentials missing: set BUXFER_EMAIL+BUXFER_PASSWORD or ensure ' +
      `sudo docker exec daylight-station is reachable (${err.message}).`,
    );
  }
  // Minimal YAML: each line `key: value`, optional quotes
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(email|password):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  if (!out.email || !out.password) {
    throw new Error('Buxfer credentials parsed but email/password missing.');
  }
  return out;
}

export async function createFinanceAccess({ getConfigService, getHttpClient }) {
    const cfg = await getConfigService();
    const auth = cfg.getHouseholdAuth('buxfer');
    if (!auth?.email || !auth?.password) {
      throw new Error('Buxfer credentials missing (data/household/auth/buxfer.yml requires email + password).');
    }
    const { BuxferAdapter } = await import('../server/adapters/BuxferAdapter.mjs');
    return new BuxferAdapter(
      { email: auth.email, password: auth.password },
      { httpClient: getHttpClient() },
    );
}
export async function createDirectFinanceAccess({ getHttpClient }) {
  const auth = readBuxferCredsDirect();
  const { BuxferAdapter } = await import('../server/adapters/BuxferAdapter.mjs');
  return new BuxferAdapter(
    { email: auth.email, password: auth.password },
    { httpClient: getHttpClient() },
  );
}
