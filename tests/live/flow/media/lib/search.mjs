// Search helpers shared by journeys: one vocabulary for the phone's full-screen
// SearchMode and the tablet/laptop dock combobox. Ordinary input only.
import { expect } from '@playwright/test';
import { aimHere } from './aim.mjs';

export const isPhone = (vp) => vp.width < 600;

export async function goArea(page, vp, area) {
  const nav = page.getByTestId(`${isPhone(vp) ? 'app-tab' : 'app-nav'}-${area}`);
  await expect(nav).toBeVisible({ timeout: 30000 });
  await nav.click();
  await expect(nav).toHaveAttribute('aria-current', 'page');
}

export const searchSurface = (page, vp) => (isPhone(vp) ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar'));

/** Open search the way a person does and return its input (phone: launcher; wider: the dock field). */
export async function openSearch(page, vp) {
  if (isPhone(vp)) {
    await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('media-search-launcher').click();
    await expect(page.getByTestId('search-mode')).toBeVisible();
    return page.getByTestId('search-mode-input');
  }
  const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await expect(input).toBeVisible({ timeout: 30000 });
  // Click where the words go (just past the search icon), as a person does:
  // the box's right part is the destination chip, and at tablet widths the
  // chip covers the box's middle — a click there changes where ▶ plays.
  await input.click({ position: { x: 48, y: 12 } });
  return input;
}

export const resultRows = (page, vp) => (isPhone(vp)
  ? page.getByTestId('search-mode-results').locator('[data-testid^="search-mode-result-"]')
  : page.locator('[data-testid^="combobox-option-"]'));

/** The row for one content id (the tap target); More is `result-more-<id>` on both surfaces. */
export const resultRow = (page, vp, id) => page.getByTestId(isPhone(vp) ? `search-mode-result-${id}` : `combobox-option-${id}`);

/** A result row's picture slot: the artwork, or the kind icon placeholder of an artwork-less item. */
export const rowPicture = (row) => row.locator('img, .media-result-thumb--icon, [data-testid="result-artwork-placeholder"]');

export async function closeSearch(page, vp) {
  if (isPhone(vp)) {
    await page.getByTestId('search-mode-close').click();
    await expect(page.getByTestId('search-mode')).toHaveCount(0);
  } else {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid^="combobox-option-"]').first()).toBeHidden();
  }
}

export async function waitForSearchSettled(page) {
  await expect.poll(async () => {
    const status = page.getByTestId('stream-status-line');
    if (await status.count() === 0) return true;
    return !/Still searching|Searching/.test(await status.first().innerText());
  }, { timeout: 40000, message: 'the search stream should settle' }).toBe(true);
}

/** Where the person is: area, address, and how far the page is scrolled. */
export async function whereAmI(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    area: document.querySelector('[aria-current="page"].media-nav-item')?.getAttribute('data-testid') ?? null,
    scroll: document.querySelector('[data-testid="media-canvas"]')?.scrollTop ?? 0,
    // Browse: the collection I am inside (its breadcrumb); other areas have no single heading.
    heading: document.querySelector('.browse-crumb--current')?.textContent?.trim() ?? null,
  }));
}

/**
 * Play a search result the way the app now has it: selecting a row (click,
 * tap or Enter) only OPENS the info view with focus on PLAY; PLAY starts it.
 * Never rely on a row click to start playback.
 */
export async function playResult(page, row, { spot = 'beginning' } = {}) {
  await row.click();
  const play = page.getByTestId('detail-play-now');
  await expect(play, 'selecting a result opens its info view (nothing plays yet)').toBeVisible({ timeout: 30000 });
  const before = await playEvidence(page);
  await play.click();
  await answerSpotChooser(page, { spot, until: async () => (await playEvidence(page)) !== before });
}

// What a PLAY changes on this page: the handle's words (a play here) or the
// outcome rows (a play elsewhere).
const playEvidence = (page) => page.evaluate(() => [
  document.querySelector('[data-testid="media-mini-player"]')?.textContent ?? '',
  document.querySelectorAll('[data-testid^="dispatch-row-"]').length,
].join('|'));

/**
 * PLAY on an item the household has saved spots for asks where to continue
 * from ("Continue <title> from…", household/SpotChooser.jsx). Answer it the way
 * a person does when it appears: 'beginning' (default) or a choice index.
 * The chooser waits on the household's spots, so it can take a few seconds;
 * `until` ends the wait early once the play has visibly started instead.
 */
export async function answerSpotChooser(page, { spot = 'beginning', until = null, waitMs = until ? 10000 : 2500 } = {}) {
  const chooser = page.getByTestId('spot-chooser');
  const deadline = Date.now() + waitMs;
  let asked = false;
  while (Date.now() < deadline) {
    if (await chooser.isVisible().catch(() => false)) { asked = true; break; }
    if (until && await until().catch(() => false)) return false;
    await page.waitForTimeout(250);
  }
  if (!asked) return false;
  await page.getByTestId(spot === 'beginning' ? 'spot-choice-beginning' : `spot-choice-${spot}`).click();
  await expect(chooser).toBeHidden({ timeout: 15000 });
  return true;
}

/** playResult after choosing This device on purpose, for journeys that play locally (nothing else aimed). */
export async function playResultHere(page, row) {
  await aimHere(page);
  await playResult(page, row);
}

/**
 * The info view leads with PLAY, Play here, Play on… and More ⋯ (detail-more);
 * every other verb (Play Next/First, Add to Queue, Add on…, Shuffle, Show
 * briefly on…, Quality…, favourites, watched marks) is an item of that menu,
 * which keeps its old test id (detail-play-next, detail-add, …).
 */
export async function openDetailMore(page) {
  const menu = page.getByTestId('detail-more-menu');
  if (!(await menu.isVisible().catch(() => false))) await page.getByTestId('detail-more').click();
  await expect(menu).toBeVisible();
  return menu;
}

/** Choose one item of the info view's More ⋯ menu by its test id. */
export async function detailVerb(page, testId) {
  await openDetailMore(page);
  await page.getByTestId(testId).click();
}
