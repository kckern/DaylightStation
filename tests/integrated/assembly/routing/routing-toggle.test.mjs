import { describe, it, expect } from '@jest/globals';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const retiredRoutingRoot = path.join(repoRoot, 'backend/src/0_system/routing');
const appEntry = path.join(repoRoot, 'backend/src/app.mjs');

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe('Retired routing-toggle boundary', () => {
  it('does not restore the deleted system-layer routing shim', async () => {
    expect(await pathExists(retiredRoutingRoot)).toBe(false);
  });

  it('keeps composition free of legacy routing toggles and envelope shims', async () => {
    const appSource = await readFile(appEntry, 'utf8');
    expect(appSource).not.toMatch(/createRoutingMiddleware|ShimMetrics|x-shim-applied|x-served-by/);
  });
});
