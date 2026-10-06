import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOUSE_FIXTURE_TITLE } from '../../../_lib/media-house-fixture.mjs';

// House view, naming, screen admin and routine history (Media P1/P2 batch C)
// against a REAL mounted virtual receiver and the REAL house router/services.
// Requires `tests/_lib/media-redesign-server.mjs` (BASE_URL): its fixture
// serves the one virtual receiver (`acceptance-media`) and the house
// contracts on in-memory stores — no household screen is commanded and the
// household's screen registry / routine history are never written.
// Ordinary pointer and keyboard input only; API calls below only set up or
// observe the receiver.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(420000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const RUN = Date.now().toString(36).slice(-5);
const SHOTS = process.env.MEDIA_HOUSE_SHOTS_DIR || null;
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
};

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function call(request, method, url, body, headers = undefined) {
  const response = await request.fetch(url, {
    method, data: body ? { commandId: randomUUID(), ...body } : undefined, headers,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status(), body: json };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openReceiver(context, request) {
  const receiver = await context.newPage();
  const ready = async () => (await call(request, 'GET', `${base}/receiver-ready`)).body?.ready === true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (await ready()) return receiver;
      await receiver.waitForTimeout(1000);
    }
  }
  expect(await ready(), 'virtual receiver never became ready').toBe(true);
  return receiver;
}

async function newDevice(browser, viewport, { name = null } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  if (name) {
    await context.addInitScript(([n]) => {
      if (!localStorage.getItem('media-app.display-name')) localStorage.setItem('media-app.display-name', n);
      localStorage.setItem('media-app.first-use-done', 'journey');
    }, [name]);
  }
  const page = await context.newPage();
  await openMedia(page);
  return { context, page };
}

// Page bootstrap under the dev server can lose a module fetch and park the
// page on its chunk-reload cooldown; that is not the behaviour under test, so
// navigation is retried a bounded number of times (the journey still fails if
// the app never comes up).
async function openMedia(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto('/media', { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 1000 });
}

async function openHouse(page) {
  const rail = page.getByTestId('app-nav-fleet');
  if (await rail.isVisible().catch(() => false)) await rail.click();
  else await page.getByTestId('app-tab-fleet').click();
  await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 30000 });
}

const clientId = (page) => page.evaluate(() => localStorage.getItem('media-app.client-id'));

test('HOUSE.2a/5a, PLAY.10a, STEER.11a: every row shows start status and who started it; Add only off; Pause all / Resume all', async ({ browser, context, request }) => {
  const receiver = await openReceiver(context, request);
  const sender = await newDevice(browser, VIEWPORTS.laptop, { name: `House sender ${RUN}` });
  const observer = await newDevice(browser, VIEWPORTS.tablet, { name: `House observer ${RUN}` });
  try {
    // The sender plays something on the receiver from the receiver's row.
    await openHouse(sender.page);
    const row = sender.page.getByTestId(`fleet-card-${DEVICE}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await sender.page.getByTestId(`fleet-play-${DEVICE}`).click();
    await sender.page.getByTestId(`fleet-play-input-${DEVICE}`).fill(HOUSE_FIXTURE_TITLE.query);
    await sender.page.getByTestId(`fleet-play-result-${HOUSE_FIXTURE_TITLE.id}`).click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');

    // RQ-HOUSE-04: the start reaches every house view, not only the sender's.
    await openHouse(observer.page);
    const observerRow = observer.page.getByTestId(`fleet-card-${DEVICE}`);
    await expect(observer.page.getByTestId(`house-start-status-${DEVICE}`)).toHaveText('Started', { timeout: 30000 });
    await expect(sender.page.getByTestId(`house-start-status-${DEVICE}`)).toHaveText('Started', { timeout: 30000 });
    // RQ-HOUSE-07: how it started, named by the device the person used.
    const startedBy = new RegExp(`^Started by House sender ${RUN}, `);
    await expect(observer.page.getByTestId(`house-started-by-${DEVICE}`)).toHaveText(startedBy, { timeout: 30000 });
    await expect(sender.page.getByTestId(`house-started-by-${DEVICE}`)).toHaveText(startedBy, { timeout: 30000 });
    await shot(observer.page, 'house-row-started-tablet');

    // RQ-PLAY-10: the row says Add only is on, and anyone can switch it off.
    expect((await call(request, 'PUT', `${base}/session/add-only`, { enabled: true })).status).toBe(200);
    await expect(observer.page.getByTestId(`house-add-only-${DEVICE}`)).toContainText('Add only is on', { timeout: 15000 });
    await shot(observer.page, 'house-row-add-only-tablet');
    await observer.page.getByTestId(`house-add-only-off-${DEVICE}`).click();
    await expect.poll(async () => (await state(request))?.controls?.addOnly, { timeout: 15000 }).toBe(false);
    await expect(observer.page.getByTestId(`house-add-only-${DEVICE}`)).toHaveCount(0, { timeout: 15000 });
    await expect(observer.page.getByTestId('dispatch-tray')).toContainText('Add only is off on Acceptance receiver');

    // RQ-STEER-13: Pause all from the house view, Resume all brings back exactly it.
    await observer.page.getByTestId('house-pause-all').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('paused');
    await expect(observer.page.getByTestId('dispatch-tray')).toContainText('Paused 1 screen');
    await expect(observer.page.getByTestId('house-resume-all')).toHaveText('Resume all (1)');
    await shot(observer.page, 'house-pause-all-tablet');
    await observer.page.getByTestId('house-resume-all').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');
    await expect(observer.page.getByTestId('house-resume-all')).toHaveCount(0);

    // Stop all from the house view (queue kept on the screen).
    await observer.page.getByTestId('house-stop-all').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).not.toBe('playing');
    await expect(observer.page.getByTestId('dispatch-tray')).toContainText('Stopped 1 screen');

    // RQ-HOUSE-04: a failed start is shown on the row to everyone. Closing the
    // receiver leaves nothing to deliver to.
    await receiver.close();
    // The load may be accepted (the WebSocket broadcast goes out) — the
    // playback watchdog then fails the start because nothing ever plays.
    await call(request, 'GET', `${base}/load?play=${HOUSE_FIXTURE_TITLE.id}&dispatchId=${randomUUID()}`);
    await expect.poll(async () => (await call(request, 'GET', `${base}/start-status`)).body?.status?.phase, { timeout: 300000 })
      .toBe('failed');
    await expect(observer.page.getByTestId(`house-start-status-${DEVICE}`)).toHaveText(/^Couldn't start at /, { timeout: 15000 });
    await shot(observer.page, 'house-row-failed-tablet');
  } finally {
    await Promise.all([sender.context.close(), observer.context.close()]);
  }
});

test('STEER.11a on the handle: Pause all / Resume all reaches this device and the receiver', async ({ browser, context, request }) => {
  const receiver = await openReceiver(context, request);
  const phone = await newDevice(browser, VIEWPORTS.phone, { name: `Handle phone ${RUN}` });
  try {
    // A screen playing elsewhere (an automation start: no device named).
    expect((await call(request, 'GET', `${base}/load?play=${HOUSE_FIXTURE_TITLE.id}&dispatchId=${randomUUID()}`)).status).toBe(200);
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');
    // And something playing here, so the handle is up.
    await phone.page.getByTestId('media-search-launcher').click();
    await phone.page.getByTestId('search-mode-input').fill(HOUSE_FIXTURE_TITLE.query);
    await phone.page.getByTestId(`search-mode-result-${HOUSE_FIXTURE_TITLE.id}`).click();
    await phone.page.getByTestId('search-mode-close').click();
    const native = phone.page.locator('.video-player video');
    await expect.poll(() => native.evaluate(v => !v.paused && v.currentTime > 0).catch(() => false), { timeout: 90000 }).toBe(true);
    const menu = phone.page.getByTestId('mini-house-menu');
    await expect(menu).toBeVisible({ timeout: 30000 });

    await menu.click();
    await phone.page.getByTestId('mini-pause-all').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('paused');
    await expect.poll(() => native.evaluate(v => v.paused), { timeout: 15000 }).toBe(true);
    await expect(phone.page.getByTestId('dispatch-tray')).toContainText('Paused 2 screens');
    await shot(phone.page, 'handle-pause-all-phone');

    await menu.click();
    await expect(phone.page.getByTestId('mini-resume-all')).toHaveText('Resume all (2)');
    await shot(phone.page, 'handle-menu-resume-phone');
    await phone.page.getByTestId('mini-resume-all').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');
    await expect.poll(() => native.evaluate(v => !v.paused), { timeout: 15000 }).toBe(true);
    expect((await call(request, 'POST', `${base}/session/transport`, { action: 'stop' })).status).toBe(200);
  } finally {
    await phone.context.close();
    await receiver.close();
  }
});

test('RELY.14a + HOUSE.4a: first use asks for a name once; names are unique, persist, and every device sees them', async ({ browser }) => {
  const first = await browser.newContext({ viewport: VIEWPORTS.phone, serviceWorkers: 'block' });
  const second = await browser.newContext({ viewport: VIEWPORTS.phone, serviceWorkers: 'block' });
  try {
    const a = await first.newPage();
    await openMedia(a);
    const card = a.getByTestId('first-use-card');
    await expect(card).toBeVisible({ timeout: 60000 });
    await expect(a.getByTestId('first-use-name')).toHaveValue(/\S/); // a sensible default
    await expect(a.getByTestId('first-use-aim')).toContainText('Things you play go to the device shown here');
    await shot(a, 'first-use-phone');
    await a.getByTestId('first-use-name').fill(`Hall phone ${RUN}`);
    await a.getByTestId('first-use-save').click();
    await expect(card).toHaveCount(0);
    await a.reload({ waitUntil: 'domcontentloaded' });
    await expect(a.getByTestId('media-shell')).toBeVisible({ timeout: 60000 });
    await expect(a.getByTestId('first-use-card')).toHaveCount(0);

    // A second device choosing the same name gets the free suggestion.
    const b = await second.newPage();
    await openMedia(b);
    await expect(b.getByTestId('first-use-card')).toBeVisible({ timeout: 60000 });
    await b.getByTestId('first-use-name').fill(`Hall phone ${RUN}`);
    await b.getByTestId('first-use-save').click();
    await expect(b.getByTestId('first-use-taken')).toContainText('is already taken');
    await shot(b, 'first-use-name-taken-phone');
    await b.getByTestId('first-use-suggestion').click();
    await expect(b.getByTestId('first-use-card')).toHaveCount(0);
    // Skipping is always possible (checked on a third, fresh device below).

    // Rename from Settings; the name persists over a reload and the house
    // view shows "(was …)" for it.
    await a.getByTestId('settings-menu-trigger').click();
    await a.getByTestId('settings-rename-device').click();
    await expect(a.getByTestId('settings-rename-name')).toHaveValue(`Hall phone ${RUN}`);
    await a.getByTestId('settings-rename-name').fill(`Den phone ${RUN}`);
    await a.getByTestId('settings-rename-save').click();
    await expect(a.getByTestId('settings-rename-dialog')).toHaveCount(0);
    await a.reload({ waitUntil: 'domcontentloaded' });
    await expect(a.getByTestId('media-shell')).toBeVisible({ timeout: 60000 });
    await openHouse(a);
    const id = await clientId(a);
    await expect(a.getByTestId(`fleet-card-browser:${id}`)).toContainText(`Den phone ${RUN}`, { timeout: 30000 });
    // wasName is the name at the start of the week's renames — here the
    // made-up "Browser 1a2b…" it had before first use, which nobody knew it
    // by, so no "(was …)" is shown. (A real rename shows it: next journey.)
    await expect(a.getByTestId(`fleet-was-name-browser:${id}`)).toHaveCount(0);
    // Another device sees the same name.
    await openHouse(b);
    await expect(b.getByTestId(`fleet-card-browser:${id}`)).toContainText(`Den phone ${RUN}`, { timeout: 60000 });
    await shot(a, 'house-was-name-phone');

    const third = await browser.newContext({ viewport: VIEWPORTS.phone, serviceWorkers: 'block' });
    const c = await third.newPage();
    await openMedia(c);
    await c.getByTestId('first-use-skip').click();
    await expect(c.getByTestId('first-use-card')).toHaveCount(0);
    await c.reload({ waitUntil: 'domcontentloaded' });
    await expect(c.getByTestId('media-shell')).toBeVisible({ timeout: 60000 });
    await expect(c.getByTestId('first-use-card')).toHaveCount(0);
    await third.close();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('HOUSE.4a/6a + AUTO.4a: renaming a routine target warns first; add, merge/unmerge, retire after routines, restore; routine history', async ({ browser }) => {
  const admin = await newDevice(browser, VIEWPORTS.tablet, { name: `Admin tablet ${RUN}` });
  const dup = await newDevice(browser, VIEWPORTS.tablet, { name: `Old tablet ${RUN}` });
  try {
    const page = admin.page;
    await openHouse(page);
    await page.getByTestId('fleet-open-screens').click();
    await expect(page.getByTestId('screen-admin-view')).toBeVisible();

    // Renaming a screen a routine uses says so first; routines follow it.
    await page.getByTestId(`screen-admin-rename-fleet:${DEVICE}`).click();
    await page.getByTestId('screen-admin-rename-name').fill(`Den receiver ${RUN}`);
    await page.getByTestId('screen-admin-rename-save').click();
    await expect(page.getByTestId('screen-admin-rename-routines')).toContainText('Acceptance button: Morning');
    await shot(page, 'admin-rename-routines-tablet');
    await page.getByTestId('screen-admin-rename-confirm').click();
    await expect(page.getByTestId(`screen-admin-item-fleet:${DEVICE}`)).toContainText(`Den receiver ${RUN}(was Acceptance receiver)`);

    // Add a screen with a name and a room.
    await page.getByTestId('screen-admin-add-name').fill(`Garage speaker ${RUN}`);
    await page.getByTestId('screen-admin-add-room').fill('Garage');
    await page.getByTestId('screen-admin-add-save').click();
    const added = page.locator('[data-testid^="screen-admin-item-screen:"]', { hasText: `Garage speaker ${RUN}` });
    await expect(added).toContainText('Garage');

    // Merge the duplicate browser into its earlier self, then unmerge.
    const dupId = `browser:${await clientId(dup.page)}`;
    const adminId = `browser:${await clientId(page)}`;
    await page.getByTestId(`screen-admin-merge-${dupId}`).click();
    await page.getByRole('radio', { name: `Admin tablet ${RUN}`, exact: true }).check();
    await shot(page, 'admin-merge-confirm-tablet');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId(`screen-admin-aliases-${adminId}`)).toContainText(`Includes Old tablet ${RUN}`);
    await expect(page.getByTestId(`screen-admin-item-${dupId}`)).toHaveCount(0);
    await shot(page, 'admin-merged-tablet');
    await page.getByTestId(`screen-admin-unmerge-${dupId}`).click();
    await expect(page.getByTestId(`screen-admin-item-${dupId}`)).toBeVisible({ timeout: 15000 });

    // Retire: the routines that point at a screen are shown first.
    await page.getByTestId(`screen-admin-retire-fleet:${DEVICE}`).click();
    await expect(page.getByTestId('screen-admin-retire-routines')).toContainText('Acceptance button: Morning');
    await page.getByTestId('confirm-cancel').click();
    const addedId = (await added.getAttribute('data-testid')).replace('screen-admin-item-', '');
    await page.getByTestId(`screen-admin-retire-${addedId}`).click();
    await expect(page.getByTestId('screen-admin-retire-routines')).toContainText('No routines point at it.');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId(`screen-admin-retired-${addedId}`)).toBeAttached();
    await page.getByTestId('screen-admin-retired').locator('summary').click();
    await shot(page, 'admin-retired-tablet');
    await page.getByTestId(`screen-admin-restore-${addedId}`).click();
    await expect(page.getByTestId(`screen-admin-item-${addedId}`)).toBeVisible();

    // Put the receiver's name back for the next run (routines confirm again).
    await page.getByTestId(`screen-admin-rename-fleet:${DEVICE}`).click();
    await page.getByTestId('screen-admin-rename-name').fill('Acceptance receiver');
    await page.getByTestId('screen-admin-rename-save').click();
    await page.getByTestId('screen-admin-rename-confirm').click();
    await expect(page.getByTestId('screen-admin-rename-dialog')).toHaveCount(0);

    // Routine history: when, which screen, what, outcome + plain reason; flags.
    await page.goBack();
    await expect(page.getByTestId('fleet-view')).toBeVisible();
    await page.getByTestId('fleet-open-routines').click();
    const runs = page.getByTestId('routine-run');
    await expect(runs.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="routine-run"][data-outcome="failed"]').first()).toContainText(/Failed: .*Acceptance receiver/);
    await expect(page.locator('[data-testid="routine-run"][data-outcome="started"]').first()).toContainText('Acceptance button: Morning');
    await expect(page.getByTestId('routine-flags')).toContainText('Needs attention');
    await shot(page, 'routine-history-tablet');
  } finally {
    await Promise.all([admin.context.close(), dup.context.close()]);
  }
});
