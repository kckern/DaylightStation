// Where ▶ plays, set and read the way a person does it. Desktop: the
// destination chip inside the search box (`search-destination-chip`) — a click
// walks one fixed cycle (usual film screen, other screens by name, This
// device) and the label reads `▶ <name>` / `▶ This device` / `▶ Choose a
// screen`. Phone: the header "Playing on" control with its popover of
// checkboxes. One vocabulary for both, so a journey names the screen, not the
// control. Ordinary input only; nothing here wakes or contacts a screen.
import { expect } from '@playwright/test';
import { A, A_NAME, B, B_NAME } from './receivers.mjs';

const NAMES = { [A]: A_NAME, [B]: B_NAME };
const MAX_STEPS = 16;
const chipOf = (page) => page.getByTestId('search-destination-chip');
const headerOf = (page) => page.getByTestId('cast-target-chip');

/** True when the phone header control is the destination surface (it does not render on desktop). */
export async function hasHeaderControl(page) {
  // Whichever destination surface this viewport has comes up first.
  await expect(headerOf(page).or(chipOf(page)).first(), 'a destination control (phone header or search chip) should be on screen').toBeVisible({ timeout: 30000 });
  return headerOf(page).isVisible().catch(() => false);
}

const chipText = async (page) => ((await chipOf(page).innerText()).replace(/\s+/g, ' ').trim());

async function stepChipTo(page, wanted) {
  const chip = chipOf(page);
  await expect(chip, 'the search box destination chip should be on screen').toBeVisible({ timeout: 30000 });
  const seen = [];
  for (let i = 0; i <= MAX_STEPS; i += 1) {
    const text = await chipText(page);
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
 * `fork`: also pick "keep playing here too" where that control exists (the
 * phone's popover; desktop has no mode control — a search row's ▶ always
 * keeps this device playing, useContentDispatch).
 */
export async function aimAt(page, id, { name = NAMES[id], fork = false } = {}) {
  if (await hasHeaderControl(page)) {
    await headerOf(page).click();
    if (fork) await page.getByTestId('cast-mode-fork').check();
    await page.getByTestId(`cast-target-checkbox-${id}`).check();
    await headerOf(page).click();
    await expect(page.getByTestId('cast-popover')).toBeHidden();
    return;
  }
  if (!name) throw new Error(`aimAt(${id}): no display name known; pass one`);
  await stepChipTo(page, `▶ ${name}`);
}

/** Aim ▶ at This device (the explicit, sticky choice). */
export async function aimHere(page) {
  if (await hasHeaderControl(page)) {
    await headerOf(page).click();
    const here = page.getByTestId('cast-target-here');
    if (!(await here.isChecked())) await here.check();
    await headerOf(page).click();
    await expect(page.getByTestId('cast-popover')).toBeHidden();
    return;
  }
  await stepChipTo(page, '▶ This device');
}

/** Where ▶ goes, as words: the screen's name or "This device" (phone: the header control's name). */
export async function aimLabel(page) {
  if (await hasHeaderControl(page)) return (await page.getByTestId('destination-control-name').innerText()).trim();
  return (await chipText(page)).replace(/^▶\s*/, '');
}

/** The locator whose text is the aim: the chip (desktop) or the header control's name (phone). */
export async function aimLocator(page) {
  return (await hasHeaderControl(page)) ? page.getByTestId('destination-control-name') : chipOf(page);
}
