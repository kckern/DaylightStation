import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createScreensRouter } from '../../../backend/src/4_api/v1/routers/screens.mjs';
import { ScreensQueryService } from '#apps/screens/ScreensQueryService.mjs';
import { FilesystemScreensRepository } from '#adapters/persistence/files/FilesystemScreensRepository.mjs';

let dataPath;

// Recording stub: on the degrade path the response body is deliberately
// indistinguishable from a screen that declares no resolution, so the warn is
// the only observable difference and has to be asserted.
let logged;
const record = (level) => (event, data) => { logged.push({ level, event, data }); };
const logger = {
  debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error'),
};
const findLog = (level, event) => logged.find((l) => l.level === level && l.event === event);

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
  const screensRepository = new FilesystemScreensRepository({
    householdDir: path.join(dataPath, 'household'),
    logger,
  });
  const screensQueryService = new ScreensQueryService({ screensRepository, logger });
  const router = createScreensRouter({ screensQueryService, logger });
  await getListHandler(router)({}, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  logged = [];
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

  it('lists a .yaml screen using its real filename', async () => {
    await fs.writeFile(
      path.join(dataPath, 'household', 'screens', 'portrait.yaml'),
      'screen: portrait\nname: Portrait\nresolution:\n  width: 540\n  height: 960\n',
    );

    const r = await callList();

    expect(r.body.screens).toEqual([
      { id: 'portrait', name: 'Portrait', resolution: { width: 540, height: 960 } },
    ]);
  });

  it('reports a null resolution for a screen that declares none', async () => {
    await writeScreen('kitchen-eink', 'screen: kitchen-eink\n');

    const r = await callList();

    expect(r.body.screens).toEqual([{ id: 'kitchen-eink', name: 'kitchen-eink', resolution: null }]);
  });

  it('treats a zero or negative dimension as no declared resolution', async () => {
    await writeScreen('zeroed', 'screen: zeroed\nresolution:\n  width: 0\n  height: 0\n');
    await writeScreen('inverted', 'screen: inverted\nresolution:\n  width: -1920\n  height: -1080\n');

    const r = await callList();

    expect(r.body.screens).toEqual(expect.arrayContaining([
      { id: 'zeroed', name: 'zeroed', resolution: null },
      { id: 'inverted', name: 'inverted', resolution: null },
    ]));
  });

  it('degrades an unparsable screen file to id-only instead of failing the list', async () => {
    await writeScreen('good', 'screen: good\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('broken', 'screen: [unclosed\n');

    const r = await callList();

    expect(r.body.screens).toHaveLength(2);
    expect(r.body.screens.find((s) => s.id === 'broken')).toEqual({ id: 'broken', name: 'broken', resolution: null });
  });

  it('warns per degraded screen and counts them on the summary line', async () => {
    await writeScreen('good', 'screen: good\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('broken', 'screen: [unclosed\n');

    await callList();

    // The body cannot distinguish "degraded" from "declares nothing", so the
    // warn is the operator's only per-screen signal.
    const warns = logged.filter((l) => l.event === 'screens.list.unreadable');
    expect(warns).toHaveLength(1);
    expect(warns[0].data).toMatchObject({ id: 'broken' });
    // The summary makes a directory-wide failure one greppable event rather than
    // N scattered warns, so its count is checked against the warns themselves —
    // a counter that drifted out of the catch must not still read as correct.
    expect(findLog('debug', 'screens.list.success')?.data).toEqual({ count: 2, unreadable: warns.length });
  });

  it('reports the error code when a screen entry is unreadable rather than malformed', async () => {
    // A directory named like a screen file: readdir lists it and the .yml filter
    // passes it, but readFile throws EISDIR. Exercises the filesystem branch,
    // where `code` is populated — unlike a YAML syntax error, whose exception
    // carries no `code` at all.
    await fs.mkdir(path.join(dataPath, 'household', 'screens', 'isdir.yml'));

    const r = await callList();

    expect(r.body.screens).toEqual([{ id: 'isdir', name: 'isdir', resolution: null }]);
    expect(findLog('warn', 'screens.list.unreadable')?.data).toMatchObject({ id: 'isdir', code: 'EISDIR' });
    expect(findLog('debug', 'screens.list.success')?.data).toEqual({ count: 1, unreadable: 1 });
  });

  it('still returns an empty list when the screens directory is absent', async () => {
    await fs.rm(path.join(dataPath, 'household', 'screens'), { recursive: true, force: true });

    const r = await callList();

    expect(r.body).toEqual({ screens: [] });
  });
});
