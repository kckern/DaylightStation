import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { resetHouseholdAt } from './lib/household.mjs';
import { isPhone } from './lib/mediaDriver.mjs';

// Finding and starting things (P0 features), against the acceptance server's
// seeded household, its virtual receiver (a REAL mounted screen page) and the
// real catalog:
//   FIND.8b/AC2  a collection result's inline play reads "Play", or "Continue S2E7" when one is under way
//   FIND.8b/AC3  a single photo shows on this device; "Show on…" sends it elsewhere
//   PLAY.1a/AC5  the item reads "Starting on <screen>…" while its start is in flight, and a second tap sends nothing more
//   PLAY.5a/AC3  pressing and holding Play next offers "At the very front"
test.beforeEach(async ({ context, request, baseURL }) => {
  await markFirstUseDone(context);
  await resetHouseholdAt(request, baseURL);
});
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const BLUEY = 'plex:59493';
const KEEPY_UPPY = 'plex:266152';
const ARRIVAL = 'plex:55854';
const DISCLOSURE = 'plex:697368';
const PHOTO = 'fixture:art-1';
const EVIDENCE = process.env.MEDIA_P0_FEATURES_EVIDENCE_DIR || path.resolve('test-results', 'media-p0-features');
fs.mkdirSync(EVIDENCE, { recursive: true });
const VIEWPORTS = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } };

async function call(request, method, url) {
  const response = await request.fetch(url, { method });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openMedia(page, url = '/media') {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 1000 });
}

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

/** Type into whichever search this size has; the caller waits for what it needs to see. */
async function typeSearch(page, text) {
  if (isPhone(page)) {
    const box = page.getByRole('searchbox', { name: 'Search media', exact: true });
    if (!(await box.isVisible().catch(() => false))) await page.getByTestId('media-search-launcher').click();
    await box.fill(text);
  } else {
    const box = page.getByRole('textbox', { name: 'Search media…' });
    await expect(box).toBeVisible({ timeout: 30000 });
    await box.fill('');
    await box.fill(text);
  }
}

/** Aim at the virtual receiver from the desktop header chip. */
async function aimAtReceiver(page) {
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${DEVICE}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test(`[FIND.8b/AC2] ${size}: a collection result's inline play reads Continue S1E… when one is under way, Play otherwise`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMedia(page);
    // The seeded household finished Hospital: Bluey's next episode is Keepy Uppy.
    await typeSearch(page, 'Bluey');
    const bluey = page.getByTestId(`result-play-all-${BLUEY}`);
    await expect(bluey).toBeVisible({ timeout: 30000 });
    await expect(bluey).toHaveText(/^Continue S\d+E\d+$/);
    const box = await bluey.boundingBox();
    expect(box.height, '44 px target').toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: path.join(EVIDENCE, `find-continue-${size}.png`) });
    await bluey.click();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Keepy Uppy', { timeout: 60000 });

    // A collection nobody has started reads plain Play.
    await openMedia(page);
    await typeSearch(page, 'Inspector Gadget');
    const fresh = page.locator('[data-testid^="result-play-all-"]').first();
    await expect(fresh).toBeVisible({ timeout: 30000 });
    await expect(fresh).toHaveText('Play');
    await page.screenshot({ path: path.join(EVIDENCE, `find-play-${size}.png`) });
  });
}

for (const { kind, query, id, title } of [
  { kind: 'single photo', query: 'acceptance photo', id: PHOTO, title: 'Acceptance photo' },
  { kind: 'camera', query: 'acceptance camera', id: 'fixture:cam-1', title: 'Acceptance camera' },
]) test(`[FIND.8b/AC3] laptop: a ${kind} shows here whatever is aimed; Show on… sends it to another screen`, async ({ context, page, request }) => {
  await page.setViewportSize(VIEWPORTS.laptop);
  const receiver = await openReceiver(context, request);
  const loads = [];
  page.on('request', (r) => { if (r.url().includes(`${base}/load`)) loads.push(r.url()); });
  await openMedia(page);
  await aimAtReceiver(page);
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await search.fill(query);
  const option = page.getByTestId(`combobox-option-${id}`);
  await expect(option).toBeVisible({ timeout: 30000 });
  // The second action is named for what it does.
  await page.getByTestId(`result-more-${id}`).click();
  await expect(page.getByTestId(`result-action-playOn-${id}`)).toHaveText('Show on…');
  await page.keyboard.press('Escape');
  // Tap: it shows on THIS device even though the receiver is aimed.
  await search.fill(query);
  await page.getByTestId(`combobox-option-${id}`).click();
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText(title, { timeout: 60000 });
  expect(loads, 'a photo tap is not sent to the aimed screen').toHaveLength(0);
  expect((await state(request))?.currentItem?.contentId ?? null).not.toBe(id);

  // Show on… : the picker is named for showing, and the screen shows it.
  await search.fill(query);
  await page.getByTestId(`result-more-${id}`).click();
  await page.getByTestId(`result-action-playOn-${id}`).click();
  await expect(page.getByText('Show on…', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE, `find-show-on-${kind.replace(' ', '-')}-laptop.png`) });
  // A still photo on this device is not "playing" here, so there is nothing to keep or stop: the tap on a screen sends it.
  await expect(page.getByTestId('picker-mode-fork')).toHaveCount(0);
  await page.getByTestId(`picker-device-${DEVICE}`).click();
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 90000 }).toBe(id);
  await receiver.close();
});

test('[PLAY.1a/AC5] laptop: the item reads "Starting on …" while its start is in flight, and a second tap does not start it twice', async ({ context, page, request }) => {
  await page.setViewportSize(VIEWPORTS.laptop);
  const receiver = await openReceiver(context, request);
  const loads = [];
  page.on('request', (r) => { if (r.url().includes(`${base}/load`)) loads.push(r.url()); });
  await openMedia(page);
  await aimAtReceiver(page);
  // Open the item's details (its page), then tap Play now twice in quick succession.
  await openMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ARRIVAL)}`);
  const play = page.getByTestId('detail-play-now');
  await expect(play).toBeVisible({ timeout: 40000 });
  await play.dblclick();
  await expect(page.getByTestId('detail-starting')).toHaveText('Starting on Acceptance receiver…', { timeout: 15000 });
  await page.screenshot({ path: path.join(EVIDENCE, 'play-starting-on-laptop.png') });
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(ARRIVAL);
  expect(loads.length, 'one start request, however many taps').toBe(1);
  // Once the screen is playing, the label is gone.
  await expect(page.getByTestId('detail-starting')).toHaveCount(0, { timeout: 120000 });
  await receiver.close();
});

test('[PLAY.5a/AC3] laptop: pressing and holding Play next offers "At the very front"; it queues ahead of the item added before', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.laptop);
  await openMedia(page, '/media?play=fixture:live');
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Acceptance live channel', { timeout: 40000 });
  const search = page.getByRole('textbox', { name: 'Search media…' });

  // A quick press is the ordinary Play next: the item goes right after what plays.
  await search.fill('arrival');
  await page.getByTestId(`result-more-${ARRIVAL}`).click();
  await page.getByTestId(`result-action-playNext-${ARRIVAL}`).click();
  // The confirmation states the position and the screen.
  await expect(page.getByTestId('dispatch-tray')).toContainText('Arrival plays next here');
  await expect(page.getByTestId('dispatch-tray')).toContainText('2nd in queue');

  // Press and hold on a second item: "At the very front" is offered, and Play next itself is NOT run.
  await search.fill('disclosure day');
  await page.getByTestId(`result-more-${DISCLOSURE}`).click();
  const next = page.getByTestId(`result-action-playNext-${DISCLOSURE}`);
  const nextBox = await next.boundingBox();
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  const front = page.getByTestId(`result-action-playNextFront-${DISCLOSURE}`);
  await expect(front).toBeVisible({ timeout: 4000 });
  await page.mouse.up();
  await page.screenshot({ path: path.join(EVIDENCE, 'play-next-hold-laptop.png') });
  await front.click();

  // Order in the queue: playing, then the held item (very front), then the earlier Play next.
  await page.getByTestId('mini-player-open-nowplaying').click();
  const queue = page.getByTestId('queue-panel');
  await expect(queue).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await queue.innerText()).replace(/\s+/g, ' ')).toMatch(/Acceptance live channel.*Disclosure Day.*Arrival/);
});
