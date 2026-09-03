import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// The settings sheets are sized to the kiosk canvas; a scrollbar is a layout
// bug. Each state is screenshotted for a human look and asserted not to
// overflow — the panel itself, and every descendant except the MIDI log
// (`role="log"`, a rolling window that scrolls by design). Arming Reboot is a
// single tap (the action needs a second) — do NOT tap it twice, and never tap
// "Turn off display" here: on the real kiosk that kills touch until FKB REST
// recovers it.
const OUT = 'tests/_artifacts/piano-settings';
const CHIP = '.piano-chrome__chip';
const PANEL = '.piano-tsheet--canvas .piano-tsheet__panel';

async function noOverflow(page, name) {
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await page.waitForTimeout(250); // let art images and fonts settle before measuring
  const sizes = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  expect(sizes.sh, `${name} scrolls vertically`).toBe(sizes.ch);
  expect(sizes.sw, `${name} scrolls horizontally`).toBe(sizes.cw);
  const inner = await panel.evaluate((el) => [...el.querySelectorAll('*')]
    .filter((n) => n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1
      && getComputedStyle(n).overflowY !== 'visible' && !n.closest('[role="log"]'))
    .map((n) => `${n.tagName.toLowerCase()}.${n.className}`).slice(0, 5));
  expect(inner, `${name} has an inner scroll region`).toEqual([]);
}

test.describe('piano settings sheets', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Sound and Maintenance fit the canvas in every state', async ({ page }) => {
    test.setTimeout(300_000); // the readiness poll alone may take 2 min on a cold backend
    // Playwright's webServer only waits for Vite; the backend behind the /api
    // proxy boots later and answers 500 through the proxy until it is up. Poll
    // a real asset to readiness first — the same request also proves the
    // illustrations are served, not just referenced (a 404 falls back to the
    // family icon and would pass the layout check while looking wrong).
    const ART = '/api/v1/static/img/music/instruments/violin-1.svg';
    await expect.poll(async () => (await page.request.get(ART)).status(), { timeout: 120_000, intervals: [2000] }).toBe(200);
    expect((await page.request.get(ART)).headers()['content-type'] || '').toContain('svg');

    await page.goto('/piano');
    await page.locator(CHIP).waitFor({ state: 'visible', timeout: 60_000 });

    // Sound: Pianos first (a family whose tiles we can name), then the two
    // largest families and Mine (favourites + shortlist).
    await page.locator(CHIP).click();
    // The piano config (device profile → voice list) loads async; a sheet
    // opened before it lands has an empty grid. Wait for a real voice tile.
    await page.getByRole('button', { name: 'Pianos' }).click();
    await expect(page.getByRole('button', { name: 'Acoustic Grand' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('img.piano-tbtn__art').first()).toBeVisible();
    await noOverflow(page, '1-sound-pianos');
    await page.getByRole('button', { name: 'Winds & Brass' }).click();
    await noOverflow(page, '2-sound-winds-and-brass');
    await page.getByRole('button', { name: 'Synths' }).click();
    await noOverflow(page, '3-sound-synths');
    await page.getByRole('button', { name: 'Mine' }).click();
    await noOverflow(page, '4-sound-mine');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sound' })).toHaveCount(0);

    // Signed-in player: the tone column grows a 48px save row, which is the
    // state the final review measured as the tightest. Pick the first roster
    // player through the chrome chip. Nothing is saved — a real favourite write
    // on a real player is not a test side effect we want.
    await page.getByRole('button', { name: 'Switch player' }).click();
    await page.locator('.piano-userpicker .piano-usercard').first().click();
    await expect(page.getByRole('button', { name: 'Switch player' })).toBeVisible();
    await page.locator(CHIP).click();
    await page.getByRole('button', { name: 'Winds & Brass' }).click();
    await expect(page.getByRole('button', { name: /^(Save sound|Update saved sound|Saved)$/ })).toBeVisible();
    await noOverflow(page, '4b-sound-signed-in-winds');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sound' })).toHaveCount(0);

    // Maintenance: hold the chip 550ms+.
    const box = await page.locator(CHIP).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Piano maintenance' })).toBeVisible();
    await noOverflow(page, '5-maintenance-idle');
    // Reboot only exists when the piano has a screensaver deviceId; Restart is
    // the same danger/two-tap path and is always present. One tap arms only.
    const hasReboot = (await page.getByRole('button', { name: 'Reboot tablet' }).count()) > 0;
    const arm = hasReboot ? ['Reboot tablet', 'Tap again to reboot tablet'] : ['Restart piano app', 'Tap again to restart piano app'];
    await page.getByRole('button', { name: arm[0] }).click();
    await expect(page.getByRole('button', { name: arm[1] })).toBeVisible();
    await noOverflow(page, '6-maintenance-danger-armed');
    await page.keyboard.press('Escape'); // disarms on close (Task 9 review #2)
    await expect(page.getByRole('dialog', { name: 'Piano maintenance' })).toHaveCount(0);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: arm[0] })).toBeVisible(); // not armed after reopen
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await expect(page.getByRole('log')).toBeVisible();
    await noOverflow(page, '7-maintenance-diagnostics');
    await page.keyboard.press('Escape');
  });
});
