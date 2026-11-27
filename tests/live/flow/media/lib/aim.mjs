// Where ▶ plays, set and read the way a person does it: the destination chip
// (`search-destination-chip`) — in the search box on wider screens, at the
// right end of the search launcher on a phone, and in the phone's search
// sheet. A click walks one fixed cycle (usual film screen, other screens by
// name, This device) and the label reads `▶ <name>` / `▶ This device` /
// `▶ Choose a screen`. One destination, shown where you type, on every width
// (the phone's header "Playing on" control is gone). Ordinary input only;
// nothing here wakes or contacts a screen.
import { expect } from '@playwright/test';
import { A, A_NAME, B, B_NAME } from './receivers.mjs';

const NAMES = { [A]: A_NAME, [B]: B_NAME };
const MAX_STEPS = 16;
// The dock's chip: the desktop box's or the phone launcher's (whichever shows).
const chipOf = (page) => page.locator('[data-testid="media-dock"] [data-testid="search-destination-chip"]:visible').first();

const chipText = async (page) => ((await chipOf(page).innerText()).replace(/\s+/g, ' ').trim());

async function stepChipTo(page, wanted) {
  return stepChip(chipOf(page), wanted);
}

/**
 * Click one destination chip (`search-destination-chip`, in the dock's search
 * box or the phone's search sheet) until it reads `wanted` ("▶ <name>",
 * "▶ This device"). Each click writes the aim only; nothing is contacted.
 */
export async function stepChip(chip, wanted) {
  await expect(chip, 'the search box destination chip should be on screen').toBeVisible({ timeout: 30000 });
  const seen = [];
  for (let i = 0; i <= MAX_STEPS; i += 1) {
    const text = (await chip.innerText()).replace(/\s+/g, ' ').trim();
    if (text === wanted) return;
    seen.push(text);
    if (i === MAX_STEPS) break;
    await chip.click();
  }
  throw new Error(`destination chip never read "${wanted}" in ${MAX_STEPS} steps; it read: ${seen.join(' | ')}`);
}

/**
 * Aim ▶ at one screen. `name` defaults to the acceptance receivers' names; any
 * other screen must pass its display name (the chip shows names, never ids).
 * `fork` is accepted for old callers and means nothing: no surface has a mode
 * control, and a search row's ▶ always keeps this device playing
 * (useContentDispatch).
 */
const sheetChipOf = (page) => page.getByTestId('search-mode').getByTestId('search-destination-chip');

/** The phone's search sheet is open: it covers the header, and has its own chip. */
async function searchSheetOpen(page) {
  return sheetChipOf(page).isVisible().catch(() => false);
}

// eslint-disable-next-line no-unused-vars
export async function aimAt(page, id, { name = NAMES[id], fork = false } = {}) {
  if (await searchSheetOpen(page)) {
    if (!name) throw new Error(`aimAt(${id}): no display name known; pass one`);
    await stepChip(sheetChipOf(page), `▶ ${name}`);
    return;
  }
  if (!name) throw new Error(`aimAt(${id}): no display name known; pass one`);
  await stepChipTo(page, `▶ ${name}`);
}

/** Aim ▶ at This device (the explicit, sticky choice). */
export async function aimHere(page) {
  if (await searchSheetOpen(page)) {
    await stepChip(sheetChipOf(page), '▶ This device');
    return;
  }
  await stepChipTo(page, '▶ This device');
}

/** Where ▶ goes, as words: the screen's name or "This device". */
export async function aimLabel(page) {
  return (await chipText(page)).replace(/^▶\s*/, '');
}

/** The locator whose text is the aim: the dock's chip. */
export async function aimLocator(page) {
  await expect(chipOf(page), 'the destination chip should be on screen').toBeVisible({ timeout: 30000 });
  return chipOf(page);
}

/**
 * Several screens at once. No control aims at several (one destination, shown
 * where you type; several screens is Play on… › Choose several screens), but a
 * stored aim can still name several and every surface must read it. Seeds the
 * stored aim and reloads.
 */
export async function seedAim(page, ids) {
  await page.evaluate((value) => localStorage.setItem('media-app.cast-target', value),
    JSON.stringify({ mode: 'fork', targetIds: ids, activityAt: Date.now() }));
  await page.reload();
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 60000 });
}
