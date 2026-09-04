/**
 * ASSET-EXISTENCE GUARD for the installed icon manifest.
 *
 * Why this file exists: on 2026-09-03 Dropbox resolved a directory conflict in
 * `media/img/music/instruments/` by creating a sibling "(KC Kern's conflicted
 * copy ...)" folder and leaving the canonical directory PRESENT BUT EMPTY. The
 * piano illustrations 404'd in production and nothing logged an error anywhere.
 * The only thing in the entire pipeline that caught it was
 * `frontend/src/modules/Piano/PianoKiosk/voiceArt.test.js`, which asserts every
 * basename the code can name exists as a file. This is the icon vocabulary's
 * equivalent, modelled on it deliberately.
 *
 * It asserts against the REAL installed manifest and the REAL media mount, so
 * it is checking deployed state, not a fixture. When either is unavailable
 * (CI, a laptop with no data mount) it SKIPS VISIBLY rather than passing on
 * nothing — a green tick that proved nothing is exactly the failure mode the
 * incident above is made of.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { IconManifestStore, ICON_SLUG_PATTERN } from './IconManifestStore.mjs';

// Same two sources tests/_lib/configHelper.mjs (and voiceArt.test.js) read:
// the environment, else a .env at the repo root, else a checkout's .env a
// couple of levels up for a worktree under .claude/worktrees/.
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
function resolveBasePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;
  let dir = REPO_ROOT;
  for (let hop = 0; hop < 5; hop += 1) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) {
      const match = readFileSync(envPath, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.+)$/m);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

const BASE = resolveBasePath();
const MEDIA_ROOT = BASE ? path.join(BASE, 'media') : null;
const MANIFEST_FILE = BASE ? path.join(BASE, 'data/household/apps/health/icon-manifest.yml') : null;

function loadInstalled() {
  const doc = yaml.load(readFileSync(MANIFEST_FILE, 'utf8'));
  const dataService = { household: { read: () => doc } };
  return {
    doc,
    store: new IconManifestStore({
      dataService,
      mediaRoot: MEDIA_ROOT,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }),
  };
}

function skipUnlessInstalled(ctx) {
  if (!BASE) ctx.skip('no DAYLIGHT_BASE_PATH in env or .env');
  else if (!existsSync(MEDIA_ROOT)) ctx.skip(`media root not mounted (${MEDIA_ROOT})`);
  else if (!existsSync(MANIFEST_FILE)) ctx.skip(`icon manifest not installed (${MANIFEST_FILE})`);
}

describe('installed icon manifest', () => {
  it('every slug the manifest can name resolves to a file that actually exists', (ctx) => {
    skipUnlessInstalled(ctx);
    const { doc, store } = loadInstalled();
    const slugs = [...Object.keys(doc.icons || {}), ...Object.keys(doc.aliases || {})];
    expect(slugs.length).toBeGreaterThan(0);
    const missing = slugs.filter((slug) => store.resolve(slug) === null);
    expect(missing).toEqual([]);
  });

  it('every manifest key is a requestable slug (a key the route would refuse is unreachable dead weight)', (ctx) => {
    skipUnlessInstalled(ctx);
    const { doc } = loadInstalled();
    const bad = [...Object.keys(doc.icons || {}), ...Object.keys(doc.aliases || {})]
      .filter((slug) => !ICON_SLUG_PATTERN.test(slug));
    expect(bad).toEqual([]);
  });

  it('no slug is both an offered icon and an alias, so resolution is unambiguous', (ctx) => {
    skipUnlessInstalled(ctx);
    const { doc } = loadInstalled();
    const icons = Object.keys(doc.icons || {});
    const overlap = Object.keys(doc.aliases || {}).filter((slug) => icons.includes(slug));
    expect(overlap).toEqual([]);
  });

});
