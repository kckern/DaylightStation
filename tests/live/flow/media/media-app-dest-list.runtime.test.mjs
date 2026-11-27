// Destination chip: cycle or pick from a list (owner ruling 2026-11-27).
// The chip in the search box still cycles on click / Tab; the ▾ joined to it
// opens every destination as a list (Alt+↓ in the box does too). A pick sets
// the same sticky destination a cycle step sets; Esc keeps the choice; focus
// returns to the box; opening the list never contacts a screen. And the box
// keeps one width whatever the chip names or which scope is chosen.
import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { gotoMedia, A, A_NAME, B, B_NAME, VIEWPORTS } from './lib/receivers.mjs';
import { openSearch, isPhone, searchSurface } from './lib/search.mjs';

const OFFLINE = 'acceptance-offline';
const SPEAKER = 'acceptance-speaker';
const LONG_NAME = 'Acceptance guest room TV';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ trace: 'retain-on-failure' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

/** Every device command the page sends (a list opening must send none). */
async function recordDeviceCommands(page) {
  const sent = [];
  await page.route('**/api/v1/device/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/(load|on|off|wake|toggle)(?:\?|$)/.test(request.url())) {
      sent.push(`${request.method()} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return sent;
}

const surfaceChip = (page, vp) => searchSurface(page, vp).getByTestId('search-destination-chip');
const surfaceToggle = (page, vp) => searchSurface(page, vp).getByTestId('search-destination-list-toggle');
const chipText = async (page, vp) => (await surfaceChip(page, vp).innerText()).replace(/\s+/g, ' ').trim();

/** Show every row: the list keeps its top few, the rest under More. */
async function showAllRows(page) {
  const more = page.getByTestId('dest-list-more');
  if (await more.isVisible().catch(() => false)) await more.click();
}

for (const [label, vp] of [['laptop', VIEWPORTS.laptop], ['phone', VIEWPORTS.phone]]) {
  test(`[dest-list] ${label}: Alt+↓ opens the list; a pick is sticky, Esc keeps the choice, nothing is woken`, async ({ page }) => {
    await page.setViewportSize(vp);
    const sent = await recordDeviceCommands(page);
    await gotoMedia(page);
    const input = await openSearch(page, vp);

    await input.press('Alt+ArrowDown');
    const list = page.getByTestId('dest-list');
    await expect(list).toBeVisible();
    await expect(surfaceToggle(page, vp)).toHaveAttribute('aria-expanded', 'true');
    await showAllRows(page);
    // The screens that take a film by name, and This device; never a speaker.
    await expect(page.getByTestId(`dest-list-row-${A}`)).toBeVisible();
    await expect(page.getByTestId(`dest-list-row-${B}`)).toBeVisible();
    await expect(page.getByTestId('dest-list-row-local')).toBeVisible();
    await expect(page.getByTestId(`dest-list-row-${SPEAKER}`)).toHaveCount(0);
    // Its live state: a screen that never connects reads Asleep.
    await expect(page.getByTestId(`dest-list-status-${OFFLINE}`)).toHaveText('Asleep');

    await page.getByTestId(`dest-list-row-${B}`).click();
    await expect(list).toBeHidden();
    await expect.poll(() => chipText(page, vp)).toBe(`▶ ${B_NAME}`);
    await expect(input).toBeFocused();

    // Careful look, no change: the ▾ opens it on the current row; Esc closes and keeps it.
    await surfaceToggle(page, vp).click();
    await expect(list).toBeVisible();
    await expect(page.getByTestId(`dest-list-row-${B}`)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId(`dest-list-row-${B}`)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect.poll(() => chipText(page, vp)).toBe(`▶ ${B_NAME}`);
    await expect(input).toBeFocused();
    // …and the search is still open (Esc closed the list, not the search).
    await expect(searchSurface(page, vp)).toBeVisible();

    // Keyboard all the way: Alt+↓, move, Enter.
    await input.press('Alt+ArrowDown');
    await expect(list).toBeVisible();
    await showAllRows(page);
    await page.getByTestId(`dest-list-row-${A}`).focus();
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    await expect.poll(() => chipText(page, vp)).toBe(`▶ ${A_NAME}`);

    // Sticky across a reload, like a cycle step.
    await gotoMedia(page);
    await openSearch(page, vp);
    await expect.poll(() => chipText(page, vp)).toBe(`▶ ${A_NAME}`);

    expect(sent, 'opening and picking from the list must never contact a screen').toEqual([]);
  });

  test(`[dest-list] ${label}: the search box keeps one width across destinations and scopes`, async ({ page }) => {
    await page.setViewportSize(vp);
    await recordDeviceCommands(page);
    await gotoMedia(page);
    const input = await openSearch(page, vp);
    const box = isPhone(vp) ? input : page.locator('.media-search-input-wrap');
    const width = async () => (await box.boundingBox()).width;
    // The text field itself (desktop: the input minus the chip's slot).
    const field = async () => input.evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingRight));

    const pickRow = async (id) => {
      await surfaceToggle(page, vp).click();
      await showAllRows(page);
      await page.getByTestId(`dest-list-row-${id}`).click();
      await expect(page.getByTestId('dest-list')).toBeHidden();
    };

    await pickRow(OFFLINE);
    await expect.poll(() => chipText(page, vp)).toBe(`▶ ${LONG_NAME}`);
    const longWidth = await width();
    const longField = await field();

    await pickRow('local');
    await expect.poll(() => chipText(page, vp)).toBe('▶ This device');
    expect(Math.abs(await width() - longWidth), 'box width, long name vs This device').toBeLessThanOrEqual(1);
    expect(Math.abs(await field() - longField), 'text field width, long name vs This device').toBeLessThanOrEqual(1);

    // A scope chip chosen beside it (its sub-scopes appear) must not push the box.
    const scope = searchSurface(page, vp).locator('.media-scope-chip-row').first().locator('[data-testid^="scope-chip-"]').nth(1);
    await scope.click();
    // Chosen: pressed, or (a scope with sub-scopes) expanded.
    await expect.poll(async () => (await scope.getAttribute('aria-pressed')) === 'true'
      || (await scope.getAttribute('aria-expanded')) === 'true', { message: 'the scope chip should read as chosen' }).toBe(true);
    expect(Math.abs(await width() - longWidth), 'box width with a scope chosen').toBeLessThanOrEqual(1);
    expect(Math.abs(await field() - longField), 'text field width with a scope chosen').toBeLessThanOrEqual(1);

    // Opening the list does not move it either.
    await surfaceToggle(page, vp).click();
    await expect(page.getByTestId('dest-list')).toBeVisible();
    expect(Math.abs(await width() - longWidth), 'box width with the list open').toBeLessThanOrEqual(1);
  });
}
