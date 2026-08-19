// tests/live/flow/screen/menu-selection-single-player.runtime.test.mjs
//
// ONE SELECTION, ONE PLAYER.
//
// THE DEFECT THIS GATE EXISTS FOR
// -------------------------------
// A screen provides its MenuNavigation stack ONCE, screen-wide (ScreenRenderer),
// and two components render it: the screen's own menu widget, and a MenuStack
// mounted as a fullscreen overlay (`?list=`, a numpad menu key, a WS dispatch).
// A selection made in the overlay pushes `{ type: 'player' }` onto that single
// shared stack — so BOTH rendered a Player. Measured on the living-room screen:
//
//   2 <video> elements, both playing, both unmuted, currentTime identical
//   (one inside .screen-overlay--fullscreen, one behind it in the widget)
//
// Doubled audio, doubled decode, and two Plex transcode sessions for one
// selection — on a backend that serialises Plex requests.
//
// WHY IT HAS TO BE A RUNTIME TEST
// -------------------------------
// Both renderers are correct in isolation and every unit test of either passes.
// The bug only exists when a real screen composes them over one real context,
// with real content actually decoding — which is exactly this file.
//
// PRECONDITIONS FAIL, THEY DO NOT SKIP
// ------------------------------------
// Per CLAUDE.md: "Skipping is NOT passing." If the screen no longer has a menu
// widget there is no second renderer and this gate would pass while proving
// nothing — so `beforeAll` throws instead, naming what went stale.

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

/** The screen whose entire layout is a menu widget — the composition under test. */
const SCREEN = 'living-room';
const ROUTE = `/screen/${SCREEN}`;
/** Opened through `?list=`, which mints a `menu:open` → a MenuStack OVERLAY. */
const MENU_ID = 'music';

/** Menu items belonging to the fullscreen overlay's MenuStack. */
const OVERLAY_ITEM = '.screen-overlay--fullscreen .menu-item';
/** Every menu item on the screen, whichever stack rendered it. */
const ANY_ITEM = '.menu-item';

let firstItem = null;

async function getJson(path) {
  const url = `${BACKEND_URL}${path}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `SINGLE-PLAYER GATE PRECONDITION FAILED: backend unreachable at ${url} (${err.message}). ` +
      `Point BASE_URL/TEST_BACKEND_URL at a running server.`,
    );
  }
  if (!res.ok) {
    throw new Error(`SINGLE-PLAYER GATE PRECONDITION FAILED: GET ${url} returned HTTP ${res.status}.`);
  }
  return res.json();
}

/** Does this screen's layout still render a menu widget? Without one, no second renderer exists. */
function hasMenuWidget(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(hasMenuWidget);
  if (typeof node !== 'object') return false;
  if (node.widget === 'menu') return true;
  return Object.values(node).some(hasMenuWidget);
}

test.beforeAll(async () => {
  // 1. The screen still composes a menu widget UNDER the overlay slot. This is
  //    the whole premise: two renderers of one nav stack.
  const config = await getJson(`/api/v1/screens/${SCREEN}`);
  if (!hasMenuWidget(config?.layout)) {
    throw new Error(
      `SINGLE-PLAYER GATE PRECONDITION FAILED: /screen/${SCREEN} no longer has a \`widget: menu\` ` +
      `in its layout, so there is no second nav-stack renderer to prove anything about. ` +
      `Point this gate at a screen that does, or delete it with the composition it guarded.`,
    );
  }

  // 2. The menu the gate drives resolves, and its first item is PLAYABLE — a
  //    submenu in that slot would mount no player at all and the assertion
  //    "exactly one player" would pass on an empty screen.
  const menu = await getJson(`/api/v1/list/watchlist/${MENU_ID}/recent_on_top`);
  firstItem = menu?.items?.[0] ?? null;
  if (!firstItem) {
    throw new Error(`SINGLE-PLAYER GATE PRECONDITION FAILED: menu "${MENU_ID}" resolved with no items.`);
  }
  const contentId = firstItem.play?.contentId ?? firstItem.queue?.contentId;
  if (!contentId) {
    throw new Error(
      `SINGLE-PLAYER GATE PRECONDITION FAILED: the first item of "${MENU_ID}" ` +
      `("${firstItem.title}") is not playable — it carries neither \`play\` nor \`queue\`. ` +
      `Selecting it mounts no player, which would make this gate vacuous.`,
    );
  }

  // 3. …and the backend can actually resolve it to media.
  const play = await getJson(`/api/v1/play/${contentId}`);
  if (!play?.mediaUrl) {
    throw new Error(
      `SINGLE-PLAYER GATE PRECONDITION FAILED: ${contentId} ("${firstItem.title}") resolved ` +
      `with no mediaUrl. Got keys: ${Object.keys(play ?? {}).join(', ')}`,
    );
  }
});

/**
 * Every media element on the screen, with the two facts that decide whether it
 * costs anything: is it running, and is it audible.
 *
 * Driven through a Playwright locator on purpose — dash playback puts the real
 * <video> inside a <dash-video> shadow root, which `document.querySelector` in
 * page script cannot see. `getRootNode().host` climbs back out of that shadow
 * root so "is it in the overlay?" can be answered for the shadow video too.
 */
async function mediaCensus(page) {
  return page.locator('video, audio').evaluateAll((els) => els.map((el) => ({
    tag: el.tagName,
    paused: el.paused,
    muted: el.muted,
    volume: el.volume,
    t: Number(el.currentTime.toFixed(1)),
    inOverlay: !!((el.getRootNode()?.host ?? el).closest?.('.screen-overlay--fullscreen')),
  })));
}

const audible = (census) => census.filter((m) => !m.paused && !m.muted && m.volume > 0);
const describeCensus = (census) => JSON.stringify(census);

/** Open the screen and wait for the `?list=` MenuStack OVERLAY to be up and populated. */
async function openMenuOverlay(page) {
  await page.goto(`${FRONTEND_URL}${ROUTE}?list=${encodeURIComponent(MENU_ID)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector(OVERLAY_ITEM, { timeout: 30000 });
  // The widget's own menu resolves from a separate fetch; let both settle before
  // counting, so "the widget yielded" cannot be read off a race.
  await page.waitForTimeout(2000);
}

test.describe('Screen menu selection — one selection, one player', () => {
  // The living-room screen renders into a fixed 960x540 screen-root; the window
  // only letterboxes it. HD keeps the box unclipped.
  test.use({ viewport: { width: 1920, height: 1080 } });

  // The stack has one renderer at a time. Two menus on screen at once is the
  // visible half of the same fault that puts two players on screen a moment
  // later, and it is far cheaper to observe.
  test('the overlay is the screen\'s only menu while it is up', async ({ page }) => {
    await openMenuOverlay(page);

    const overlayItems = await page.locator(OVERLAY_ITEM).count();
    const allItems = await page.locator(ANY_ITEM).count();

    expect(overlayItems, 'the overlay menu rendered no items').toBeGreaterThan(0);
    expect(
      allItems,
      `${allItems - overlayItems} menu items are rendered OUTSIDE the overlay — the screen's ` +
      `menu widget is rendering the same nav stack the overlay owns. A selection will mount ` +
      `a player in both.`,
    ).toBe(overlayItems);
  });

  // The gate proper.
  test('selecting an item leaves exactly one player, and it is the overlay\'s', async ({ page }) => {
    await openMenuOverlay(page);

    await page.keyboard.press('Enter');

    // Wait for the transport to be REALLY running: a paused-but-mounted element
    // would let a second player hide behind "nothing is playing yet".
    await page.waitForSelector('video, audio, dash-video', { state: 'attached', timeout: 60000 });
    await expect
      .poll(async () => audible(await mediaCensus(page)).length, {
        timeout: 60000,
        message: `"${firstItem?.title}" never started playing — nothing on the screen is audible`,
      })
      .toBeGreaterThan(0);

    const census = await mediaCensus(page);

    // 1. ONE audible stream. This is the doubled-audio assertion.
    expect(
      audible(census).length,
      `expected exactly ONE audible stream, got ${audible(census).length}: ${describeCensus(census)}`,
    ).toBe(1);

    // 2. ONE video element at all — muting a second copy would still cost a
    //    transcode session and its bandwidth, so silence is not the bar.
    expect(
      census.filter((m) => m.tag === 'VIDEO').length,
      `expected exactly ONE <video> on the screen: ${describeCensus(census)}`,
    ).toBe(1);

    // 3. …and the survivor is the overlay's, not an orphan behind it.
    expect(
      audible(census)[0].inOverlay,
      `the audible stream is NOT inside .screen-overlay--fullscreen: ${describeCensus(census)}`,
    ).toBe(true);
  });

  // This one is GREEN before the fix as well — Escape pops the shared stack, so
  // both copies of the player come down together. It is here because the fix
  // makes the widget's MenuStack unmount and remount around the overlay, and
  // that must not strand a player behind the menu: the cure must not reproduce
  // the disease from the other side.
  test('backing out of the player leaves nothing playing', async ({ page }) => {
    await openMenuOverlay(page);
    await page.keyboard.press('Enter');

    await page.waitForSelector('video, audio, dash-video', { state: 'attached', timeout: 60000 });
    await expect
      .poll(async () => audible(await mediaCensus(page)).length, { timeout: 60000 })
      .toBeGreaterThan(0);

    // Escape pops the nav stack one level — back to the menu the selection came from.
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => audible(await mediaCensus(page)).length, {
        timeout: 20000,
        message: 'something is still playing after backing out of the player',
      })
      .toBe(0);

    await expect(page.locator(OVERLAY_ITEM).first()).toBeVisible({ timeout: 10000 });
  });
});
