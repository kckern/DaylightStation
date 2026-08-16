import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createScreensRouter } from '../../../backend/src/4_api/v1/routers/screens.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };

const writeScreen = (id, yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'screens', `${id}.yml`), yamlStr);

function getListHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const callList = async () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  const router = createScreensRouter({ householdDir: path.join(dataPath, 'household'), logger });
  await getListHandler(router)({}, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'screens-list-'));
  await fs.mkdir(path.join(dataPath, 'household', 'screens'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('screens list endpoint', () => {
  it('carries each screen declared CSS-pixel resolution', async () => {
    await writeScreen('living-room', 'screen: living-room\nname: Living Room\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('office', 'screen: office\nresolution:\n  width: 1280\n  height: 720\n');

    const r = await callList();

    expect(r.body.screens).toEqual(expect.arrayContaining([
      { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
      { id: 'office', name: 'office', resolution: { width: 1280, height: 720 } },
    ]));
  });

  it('reports a null resolution for a screen that declares none', async () => {
    await writeScreen('kitchen-eink', 'screen: kitchen-eink\n');

    const r = await callList();

    expect(r.body.screens).toEqual([{ id: 'kitchen-eink', name: 'kitchen-eink', resolution: null }]);
  });

  it('degrades an unparsable screen file to id-only instead of failing the list', async () => {
    await writeScreen('good', 'screen: good\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('broken', 'screen: [unclosed\n');

    const r = await callList();

    expect(r.body.screens).toHaveLength(2);
    expect(r.body.screens.find((s) => s.id === 'broken')).toEqual({ id: 'broken', name: 'broken', resolution: null });
  });

  it('still returns an empty list when the screens directory is absent', async () => {
    await fs.rm(path.join(dataPath, 'household', 'screens'), { recursive: true, force: true });

    const r = await callList();

    expect(r.body).toEqual({ screens: [] });
  });
});
