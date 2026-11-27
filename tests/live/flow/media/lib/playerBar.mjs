// The one player bar (Now Playing and a screen's Remote), after the Now Playing
// ruling of 2026-11-27: Stop and the session settings live in More ⋯, speed and
// Quality… in ⚙, a queue row's edits in its own ⋯, sending elsewhere behind
// Play on…. The menus render inside the bar (no portal), so a scope such as
// the Remote panel still finds their items.
import { expect } from '@playwright/test';

const isOpen = async (scope, menuTestId) => (await scope.getByTestId(menuTestId).count()) > 0
  && scope.getByTestId(menuTestId).first().isVisible();

/** Open More ⋯ (idempotent) and return the scope for its items. */
export async function openMore(scope) {
  if (!(await isOpen(scope, 'np-more-menu'))) await scope.getByTestId('np-more').first().click();
  await expect(scope.getByTestId('np-more-menu').first()).toBeVisible();
  return scope;
}

/** Open ⚙ (idempotent). */
export async function openSettings(scope) {
  if (!(await isOpen(scope, 'np-settings-menu'))) await scope.getByTestId('np-settings').first().click();
  await expect(scope.getByTestId('np-settings-menu').first()).toBeVisible();
  return scope;
}

/** The Stop item, More ⋯ opened first. */
export async function stopControl(scope) {
  await openMore(scope);
  return scope.getByTestId('np-stop').first();
}

export async function pressStop(scope) {
  await (await stopControl(scope)).click();
}

/** A More ⋯ item (sleep-timer-button, stop-after-current, add-only-toggle…). */
export async function moreItem(scope, testId) {
  await openMore(scope);
  return scope.getByTestId(testId).first();
}

/** The speed item in ⚙ (tap cycles 1× → 1.25× → 1.5× → 2× → 0.75×). */
export async function rateControl(scope) {
  await openSettings(scope);
  return scope.getByTestId('np-rate').first();
}

/** A queue row's ⋯ verb: 'jump' (Play Now), 'moveup', 'movedown', 'remove', 'details'. */
export async function queueVerb(scope, verb, queueItemId) {
  const item = scope.getByTestId(`queue-${verb}-${queueItemId}`).first();
  if (!(await item.isVisible().catch(() => false))) await scope.getByTestId(`queue-menu-${queueItemId}`).first().click();
  return item;
}

/** Press Escape to close whatever bar menu is open. */
export async function closeMenus(page) {
  await page.keyboard.press('Escape');
}

/** The Play on… picker for what plays here (handoff-section wraps it). */
export async function openPlayOn(page) {
  await page.getByTestId('np-play-on').first().click();
  const section = page.getByTestId('handoff-section');
  await expect(section).toBeVisible();
  return section;
}

/**
 * Cleanup: stop whatever plays on this device, from Now Playing's More ⋯ when
 * it is open, else from the bottom bar. Quiet when nothing plays.
 */
export async function stopHere(page) {
  if (page.isClosed()) return;
  const more = page.getByTestId('now-playing-view').getByTestId('np-more');
  if (await more.isVisible().catch(() => false)) {
    await pressStop(page.getByTestId('now-playing-view')).catch(() => {});
    return;
  }
  const mini = page.getByTestId('mini-stop');
  if (await mini.isVisible().catch(() => false)) await mini.click().catch(() => {});
}

/**
 * Volume down / up one step (10). Touch shows −/+; a pointer device shows a
 * slider (owner ruling 2026-11-27) — never both.
 */
export async function volumeStep(scope, direction) {
  const button = scope.getByRole('button', { name: direction < 0 ? 'Decrease volume' : 'Increase volume' });
  if (await button.isVisible().catch(() => false)) { await button.click(); return; }
  const slider = scope.getByTestId('np-volume').first();
  const now = Number(await slider.inputValue());
  await slider.fill(String(Math.max(0, Math.min(100, now + (direction < 0 ? -10 : 10)))));
}

/** The level the bar holds (a tooltip / aria value, not printed). */
export async function volumeLevel(scope) {
  return Number((await scope.getByTestId('np-volume-level').first().textContent()).replace('%', ''));
}
