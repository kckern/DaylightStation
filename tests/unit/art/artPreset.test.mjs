import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createArtRouter } from '../../../backend/src/4_api/v1/routers/art.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const artAdapter = { selectFeatured: async () => ({ mode: 'single', panels: [], matte: {} }) };

function presetHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/preset/:key' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (key) => {
  const r = res();
  await presetHandler(createArtRouter({ artAdapter, householdDir: path.join(dataPath, 'household'), logger }))({ params: { key } }, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artpreset-'));
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
  await fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'),
    'presets:\n  classical-evening:\n    collection: all\n    music: { queue: "plex:1" }\n    matMargin: 4\n');
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('art router /preset/:key', () => {
  it('returns resolved props for a known preset', async () => {
    const r = await call('classical-evening');
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ collection: 'all', music: { queue: 'plex:1' }, matMargin: 4 });
  });
  it('404 for an unknown preset', async () => {
    const r = await call('nope');
    expect(r.statusCode).toBe(404);
  });
  it('404 when artmode.yml is absent', async () => {
    await fs.rm(path.join(dataPath, 'household', 'config', 'artmode.yml'));
    const r = await call('classical-evening');
    expect(r.statusCode).toBe(404);
  });

  it('resolves a bare collection via fallback, with defaults + expanded frame', async () => {
    await fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), [
      'frames:',
      '  gold: { insets: { top: 11, right: 6, bottom: 11, left: 7 }, matMargin: 4, cropMaxPerSide: 8 }',
      'defaults: { frame: gold, placard: true }',
      'presets: { gallery-silent: { collection: paintings } }',
    ].join('\n') + '\n');
    await fs.writeFile(path.join(dataPath, 'household', 'config', 'art.yml'),
      'collections:\n  baroque: { dateMin: 1600 }\n');
    const r = await call('baroque');
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      collection: 'baroque', placard: true, matMargin: 4, cropMaxPerSide: 8,
      frame: { top: 11, right: 6, bottom: 11, left: 7 },
    });
  });

  it('404 for a key that is neither a preset nor a collection', async () => {
    await fs.writeFile(path.join(dataPath, 'household', 'config', 'art.yml'),
      'collections:\n  baroque: { dateMin: 1600 }\n');
    const r = await call('totally-unknown');
    expect(r.statusCode).toBe(404);
  });
});
