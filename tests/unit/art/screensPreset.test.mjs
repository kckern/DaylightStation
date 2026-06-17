import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createScreensRouter } from '../../../backend/src/4_api/v1/routers/screens.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };

const writeScreen = (id, yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'screens', `${id}.yml`), yamlStr);
const writeArtmode = (yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), yamlStr);

function getHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/:screenId' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (id) => {
  const r = res();
  await getHandler(createScreensRouter({ dataPath, logger }))({ params: { screenId: id } }, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'screens-'));
  await fs.mkdir(path.join(dataPath, 'household', 'screens'), { recursive: true });
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
  await writeArtmode([
    'presets:',
    '  gallery-silent:',
    '    collection: all',
    '    music: null',
    '    matMargin: 4',
  ].join('\n') + '\n');
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('screens router preset expansion', () => {
  it('expands a preset reference into screensaver.props', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ collection: 'all', music: null, matMargin: 4 });
  });

  it('inline props override the preset', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n  props:\n    matMargin: 6\n');
    const r = await call('room');
    expect(r.body.screensaver.props.matMargin).toBe(6);
    expect(r.body.screensaver.props.collection).toBe('all');
  });

  it('unknown preset → inline props only', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: nope\n  props:\n    matMargin: 7\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 7 });
  });

  it('no preset → config returned unchanged', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  props:\n    matMargin: 8\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 8 });
  });

  it('missing artmode.yml → preset ref falls back to inline props', async () => {
    await fs.rm(path.join(dataPath, 'household', 'config', 'artmode.yml'));
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n  props:\n    matMargin: 5\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 5 });
  });

  it('merges defaults + named frame; a bare collection name resolves via fallback', async () => {
    await writeArtmode([
      'frames:',
      '  gold: { insets: { top: 11, right: 6, bottom: 11, left: 7 }, matMargin: 4, cropMaxPerSide: 8 }',
      'defaults: { frame: gold, placard: true }',
      'presets: { gallery-silent: { collection: paintings } }',
    ].join('\n') + '\n');
    await fs.writeFile(path.join(dataPath, 'household', 'config', 'art.yml'),
      'collections:\n  baroque: { dateMin: 1600 }\n');
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: baroque\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({
      collection: 'baroque', placard: true, matMargin: 4, cropMaxPerSide: 8,
      frame: { top: 11, right: 6, bottom: 11, left: 7 },
    });
  });
});
