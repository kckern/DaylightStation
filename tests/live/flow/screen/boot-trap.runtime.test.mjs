/**
 * The boot trap in `frontend/index.html` must never strand a kiosk.
 *
 * 2026-08-26: the trap stayed armed for the life of the page, so a benign
 * promise rejection from the checkers board painted "This screen could not
 * start" over a piano kiosk that was rendering at 59.9fps — and kept rendering
 * underneath it for 23 minutes. The panel's only advice was "a grown-up can
 * reload the page", offered to a wall tablet with no address bar, no keyboard
 * and no reload button. Recovery required FullyKiosk's REST API from a laptop.
 *
 * These are the three invariants that make that impossible. They exercise the
 * REAL script block, lifted out of index.html at run time, so the test cannot
 * drift from what ships.
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getAppPort } from '../../../_lib/configHelper.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(here, '../../../../frontend/index.html');
// The harness cases below serve the trap themselves, but the two mount cases
// need a REAL app. `getAppPort()` is the SSOT and resolves to whatever this
// host serves; DAYLIGHT_APP_PORT overrides it so the fix can be verified
// against a dev server before the change is built and deployed to that port.
const APP = `http://localhost:${process.env.DAYLIGHT_APP_PORT || getAppPort()}/`;

/** The trap, verbatim from the file that ships it. */
function trapScript() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const match = html.match(/<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/);
  if (!match) throw new Error('boot trap script not found in frontend/index.html');
  return match[0];
}

/**
 * A page that boots the trap and then dies, without the app bundle.
 * `/throws` raises immediately; `/never-mounts` just leaves #root empty.
 */
async function startHarness() {
  const trap = trapScript();
  let bootErrors = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/v1/system/boot-error')) {
      bootErrors += 1;
      res.writeHead(204).end();
      return;
    }
    const boom = req.url.startsWith('/throws')
      ? '<script>throw new Error("bundle exploded");</script>'
      : '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body style="background:black"><div id="root"></div>${trap}${boom}</body></html>`);
  });
  await new Promise((r) => server.listen(0, r));
  return {
    origin: `http://localhost:${server.address().port}`,
    posts: () => bootErrors,
    close: () => server.close(),
  };
}

const mounted = (page) => page.waitForFunction(
  () => document.getElementById('root')?.children.length > 0,
  null,
  { timeout: 30000 },
);

test('a rejection after mount paints nothing', async ({ page }) => {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await mounted(page);

  await page.evaluate(() => { Promise.reject(new Error('Session local:deadbeef is complete')); });
  await page.waitForTimeout(2500);

  expect(await page.locator('[data-boot-error]').count()).toBe(0);
  expect(await page.evaluate(() => document.getElementById('root').children.length)).toBeGreaterThan(0);
});

test('a successful mount removes a panel painted by a racing rejection', async ({ page }) => {
  // Fires while the trap is still armed but before the app has mounted.
  await page.addInitScript(() => { setTimeout(() => { Promise.reject(new Error('early boom')); }, 40); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await mounted(page);
  await page.waitForTimeout(1500);

  expect(await page.locator('[data-boot-error]').count()).toBe(0);
});

test('a dead boot restarts itself instead of stranding the screen', async ({ page }) => {
  const harness = await startHarness();
  try {
    let loads = 0;
    page.on('load', () => { loads += 1; });
    await page.goto(`${harness.origin}/throws`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('[data-boot-error]', { timeout: 10000 });
    const text = await page.locator('[data-boot-error]').textContent();
    expect(text).toMatch(/restarting itself/i);
    expect(text).toMatch(/tap anywhere to restart now/i);
    // The exact copy that made 2026-08-26 unrecoverable. It must not come back.
    expect(text).not.toMatch(/grown-up can reload the page/i);

    const loadsBefore = loads;
    const postsBefore = harness.posts();
    await page.waitForTimeout(16000); // spans the 2s + 4s + 8s backoff steps

    expect(loads).toBeGreaterThanOrEqual(loadsBefore + 2);
    expect(harness.posts()).toBeGreaterThanOrEqual(postsBefore + 2);

    const attempt = await page.evaluate(() => {
      try { return Number(sessionStorage.getItem('daylight.boot.attempt')); } catch { return 0; }
    });
    // Escalating, not hammering a failing server at a fixed interval.
    expect(attempt).toBeGreaterThanOrEqual(2);
  } finally {
    harness.close();
  }
});

test('an empty #root is caught and also retries', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(`${harness.origin}/never-mounts`, { waitUntil: 'domcontentloaded' });
    // The empty-root check is deliberately late so a slow device is not accused.
    await page.waitForSelector('[data-boot-error]', { timeout: 26000 });
    expect(await page.locator('[data-boot-error]').textContent()).toMatch(/restarting itself/i);
  } finally {
    harness.close();
  }
});
