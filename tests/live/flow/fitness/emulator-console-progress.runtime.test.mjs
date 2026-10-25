import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { createEmulatorConsoleFixture } from '../../../_lib/emulatorConsoleFixture.mjs';

let fixture;
test.describe('real console progress integrity with isolated saves', () => {
  test.setTimeout(120000);
  test.beforeAll(async ({ playwright }) => {
    fixture = await createEmulatorConsoleFixture({ frontendUrl: FRONTEND_URL,
      upstream: await playwright.request.newContext(), protectedAssetRoot: process.env.EMULATOR_NATIVE_ASSET_ROOT });
  });
  test.afterAll(async () => { await fixture?.close(); });
  async function open(page, game) {
    await page.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true,
      value: { request: async () => ({ release: async () => {}, addEventListener() {}, removeEventListener() {} }) } }));
    await page.goto(game.url);
    await expect(page.getByTestId('session-state')).toHaveText('playing');
  }
  async function mark(page, value) {
    await page.waitForFunction(() => EJS_emulator.gameManager.functions.getFrameNum() >= 120, null, { timeout: 15000 });
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.waitForFunction(() => EJS_emulator.paused === true);
    return page.evaluate(value => {
      const m = EJS_emulator.gameManager.Module, ptr = m._daylight_memory_data_v1(2), size = m._daylight_memory_size_v1(2);
      if (!ptr || size < 0x14c9) throw Error('A real Gambatte WRAM region is required');
      m.HEAPU8[ptr + 0x14c5] = value;
      return value;
    }, value);
  }
  async function marker(page) {
    return page.evaluate(() => {
      const m = EJS_emulator.gameManager.Module, ptr = m._daylight_memory_data_v1(2);
      if (!ptr) throw Error('No native WRAM');
      return m.HEAPU8[ptr + 0x14c5];
    });
  }
  for (const exit of ['bezel', 'menu', 'hotspot', 'host']) test(`saves and restores actual native progress through ${exit} exit`, async ({ page }) => {
    const game = fixture.registerGame(); await open(page, game); await mark(page, 21);
    if (exit === 'menu') await page.getByRole('button', { name: 'Exit game', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      if (exit === 'bezel') await page.getByRole('button', { name: 'Exit emulator', exact: true }).click();
      if (exit === 'hotspot') await page.getByRole('button', { name: 'Bezel exit', exact: true }).click();
      if (exit === 'host') await page.getByRole('button', { name: 'Close host', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
    const saved = await fixture.read(game); expect(saved.snapshot.length).toBeGreaterThan(1000); expect(saved.battery.length).toBeGreaterThan(1000);
    await page.getByRole('button', { name: 'Open game', exact: true }).click();
    await expect(page.getByTestId('session-state')).toHaveText('playing');
    expect(await marker(page)).toBe(21);
    expect((await fixture.read(game)).revision).toBe(saved.revision);
  });
  test('restores snapshot-only progress with the same guarded lifecycle', async ({ page }) => {
    const game = fixture.registerGame({ saveMode: 'state' }); await open(page, game); await mark(page, 22);
    await page.getByRole('button', { name: 'Exit game', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
    const saved = await fixture.read(game); expect(saved.battery).toBeNull();
    await page.getByRole('button', { name: 'Open game', exact: true }).click(); await expect(page.getByTestId('session-state')).toHaveText('playing');
    expect(await marker(page)).toBe(22);
  });
  test('recovers durable local progress after a failed exit and reload', async ({ page }) => {
    const game = fixture.registerGame(); await open(page, game); await mark(page, 23);
    const failedSave = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ECHECKPOINTUNAVAILABLE', error: 'Temporary save failure' }) });
    await page.route('**/api/v1/emulator/checkpoint/**', route => route.request().method() === 'PUT' ? failedSave(route) : route.continue());
    await page.getByRole('button', { name: 'Exit game', exact: true }).click(); await expect(page.getByText('Temporary save failure', { exact: true })).toBeVisible();
    expect(await fixture.read(game)).toBeNull();
    await page.unroute('**/api/v1/emulator/checkpoint/**'); await page.reload();
    await expect(page.getByTestId('session-state')).toHaveText('playing'); expect(await marker(page)).toBe(23);
    expect((await fixture.read(game)).snapshot.length).toBeGreaterThan(1000);
  });
  test('rejects a reordered older writer and preserves both branches through explicit recovery', async ({ page, browser }) => {
    const game = fixture.registerGame(); await open(page, game); await mark(page, 24);
    const other = await browser.newContext(); const second = await other.newPage();
    let release; const held = new Promise(done => { release = done; });
    let entered; const requested = new Promise(done => { entered = done; });
    try {
      await open(second, game); await mark(second, 25);
      await page.route('**/api/v1/emulator/checkpoint/**', async route => {
        if (route.request().method() === 'PUT') { entered(); await held; }
        await route.continue();
      });
      await page.getByRole('button', { name: 'Exit game', exact: true }).click(); await requested;
      expect(await fixture.read(game)).toBeNull();
      await second.getByRole('button', { name: 'Exit game', exact: true }).click();
      await expect(second.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
      const newer = await fixture.read(game); release();
      await expect(page.getByRole('button', { name: 'Review recovery copies', exact: true })).toBeVisible();
      expect((await fixture.read(game)).revision).toBe(newer.revision); expect(await marker(page)).toBe(24);
      await page.getByRole('button', { name: 'Review recovery copies', exact: true }).click();
      await page.getByRole('button', { name: /^Restore local copy/ }).last().click();
      await expect(page.getByTestId('session-state')).toHaveText('playing'); expect(await marker(page)).toBe(24);
      expect((await fixture.history(game)).some(point => point.revision === newer.revision)).toBe(true);
      expect((await fixture.read(game)).revision).not.toBe(newer.revision);
    } finally { release(); await other.close(); }
  });
  test('can explicitly start fresh from the menu recovery screen while retaining the acknowledged game', async ({ page }) => {
    const game = fixture.registerGame(); await open(page, game); await mark(page, 26);
    await page.getByRole('button', { name: 'Exit game', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
    const previous = await fixture.read(game);
    await page.getByRole('button', { name: 'Open game', exact: true }).click(); await expect(page.getByTestId('session-state')).toHaveText('playing');
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Recover progress', exact: true }).click();
    await page.getByRole('button', { name: 'Start a fresh game', exact: true }).click();
    await page.getByRole('button', { name: 'Start over', exact: true }).click({ timeout: 5000 });
    await expect(page.getByTestId('session-state')).toHaveText('playing'); expect((await fixture.read(game)).kind).toBe('reset');
    expect((await fixture.history(game)).some(point => point.revision === previous.revision)).toBe(true);
  });
  test('does not seed a fresh game from another game session in EmulatorJS native browser storage', async ({ page }) => {
    const game = fixture.registerGame(); await open(page, game); await mark(page, 27);
    const previous = await page.evaluate(async () => {
      const gm = EJS_emulator.gameManager, m = gm.Module;
      const ptr = m._daylight_memory_data_v1(0), size = m._daylight_memory_size_v1(0);
      if (!ptr || !size) throw Error('Real battery RAM is required');
      const changed = m.HEAPU8[ptr + size - 1] ^ 0x5a; m.HEAPU8[ptr + size - 1] = changed;
      gm.getSaveFile(); await new Promise((resolve, reject) => gm.FS.syncfs(false, error => error ? reject(error) : resolve()));
      return { path: gm.getSaveFilePath(), changed };
    });
    await page.getByRole('button', { name: 'Exit game', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
    const fresh = fixture.registerGame(); await open(page, fresh);
    const current = await page.evaluate(() => {
      const gm = EJS_emulator.gameManager, m = gm.Module, ptr = m._daylight_memory_data_v1(0), size = m._daylight_memory_size_v1(0);
      return { path: gm.getSaveFilePath(), byte: m.HEAPU8[ptr + size - 1], mount: gm.FS.lookupPath('/data/saves').node.mount.mountpoint };
    });
    expect(current.path).not.toBe(previous.path); expect(current.byte).not.toBe(previous.changed);
    expect(current.mount).toBe('/');
    expect(await fixture.read(fresh)).toBeNull();
  });
  test('rejects a real native corrupt snapshot without silently using the battery or saving startup bytes', async ({ page }) => {
    const game = fixture.registerGame(); const original = await fixture.importCorrupt(game);
    await page.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => ({ release: async () => {}, addEventListener() {} }) } }));
    await page.goto(game.url); await expect(page.getByText('Could not restore saved progress.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close host', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open game', exact: true })).toBeVisible();
    expect((await fixture.read(game)).revision).toBe(original.revision); expect(await fixture.history(game)).toHaveLength(1);
  });
});
