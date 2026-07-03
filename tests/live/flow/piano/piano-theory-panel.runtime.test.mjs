/**
 * Piano Theory Panel — bounding-box regression test
 *
 * Guards the failure this whole effort fixed: the live chord-staff SVG had
 * height:100% with no definite-height ancestor, so it fell back to its viewBox
 * intrinsic aspect and ballooned to ~2653px tall inside a 256px card, shoving
 * the circle of fifths and chord plaque out of the (clipped) pane — leaving only
 * high-note stems peeking in.
 *
 * This measures the REAL bounding boxes of the theory panel on the Studio page
 * and fails if any theory element escapes its pane, at rest AND while a high
 * note is held (the exact trigger of the original regression). It also asserts
 * the staff engraving is landscape (aspect-filled), catching a silent fall-back
 * to the narrow portrait engraving.
 *
 * Run:
 *   npx playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs
 *   BASE_URL=http://localhost:3121 npx playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs
 */

import { test, expect } from '@playwright/test';

const VIEWPORT = { width: 1920, height: 1200 };
const TOL = 2; // px tolerance for "fits inside the pane"

/** Read getBoundingClientRect for a selector (null if absent). */
async function box(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      right: r.right, bottom: r.bottom,
      viewBox: el.getAttribute && el.getAttribute('viewBox'),
    };
  }, selector);
}

/** Assert `inner` sits within `outer` (with tolerance) and is non-degenerate. */
function expectInside(inner, outer, label) {
  expect(inner, `${label} should exist`).not.toBeNull();
  expect(inner.w * inner.h, `${label} should be non-degenerate`).toBeGreaterThan(0);
  expect(inner.x, `${label} left edge inside pane`).toBeGreaterThanOrEqual(outer.x - TOL);
  expect(inner.y, `${label} top edge inside pane`).toBeGreaterThanOrEqual(outer.y - TOL);
  expect(inner.right, `${label} right edge inside pane`).toBeLessThanOrEqual(outer.right + TOL);
  expect(inner.bottom, `${label} bottom edge inside pane`).toBeLessThanOrEqual(outer.bottom + TOL);
}

test.describe('Piano Theory Panel bounding boxes', () => {
  test.setTimeout(60_000);

  test('circle, staff, and chord stay inside the Studio pane (rest + high note held)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    await page.goto('/piano/studio');
    await page.waitForLoadState('networkidle');

    // Headless has no Web MIDI, so the connect gate shows — dismiss it.
    const skip = page.locator('.piano-connect-gate__skip');
    if (await skip.count()) {
      await skip.click();
    }

    // The Studio top pane must render (fail fast if it doesn't — no vacuous pass).
    await page.waitForSelector('.piano-studio-toppane', { timeout: 15_000 });
    await page.waitForSelector('.theory-panel--row .chord-staff svg', { timeout: 15_000 });

    // ── At rest ──────────────────────────────────────────────────────
    const pane = await box(page, '.piano-studio-toppane');
    expect(pane, 'studio top pane exists').not.toBeNull();

    const circle = await box(page, '.piano-circle-of-fifths');
    const staff = await box(page, '.chord-staff svg');
    const chord = await box(page, '.piano-chord-name__plaque');

    expectInside(circle, pane, 'circle of fifths');
    expectInside(staff, pane, 'chord staff (rest)');
    expectInside(chord, pane, 'chord plaque');

    // The staff SVG must be bounded to the pane height — the core regression was
    // a ~2653px-tall SVG. Assert it never exceeds the pane height.
    expect(staff.h, 'staff SVG height bounded to pane').toBeLessThanOrEqual(pane.h + TOL);

    // Aspect-fill proof: in the wide Studio row slot the engraving viewBox must be
    // landscape (widened past the ~100x192 portrait default). A fall-back to
    // portrait would leave big side gutters and signal the ResizeObserver broke.
    const vb = staff.viewBox?.split(/\s+/).map(Number);
    expect(vb, 'staff SVG has a viewBox').toBeTruthy();
    expect(vb[2], 'staff viewBox width > height (aspect-filled)').toBeGreaterThan(vb[3]);

    // ── While a high note is held ────────────────────────────────────
    // Press a far-right (high) key on the on-screen keyboard; extreme ledger
    // lines are what first exposed the balloon. The staff must STILL fit.
    const kb = await page.locator('.piano-keyboard').first().boundingBox();
    expect(kb, 'on-screen keyboard exists').not.toBeNull();
    await page.mouse.move(kb.x + kb.width * 0.94, kb.y + kb.height * 0.7);
    await page.mouse.down();
    try {
      await page.waitForTimeout(400);
      const staffHeld = await box(page, '.chord-staff svg');
      const paneHeld = await box(page, '.piano-studio-toppane');
      expectInside(staffHeld, paneHeld, 'chord staff (high note held)');
      expect(staffHeld.h, 'held staff SVG height bounded to pane').toBeLessThanOrEqual(paneHeld.h + TOL);
    } finally {
      await page.mouse.up();
    }

    await context.close();
  });
});
