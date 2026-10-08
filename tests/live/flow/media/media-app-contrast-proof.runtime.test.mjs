import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import { VIEWPORTS, newAppPage, gotoMedia, warmMedia, openRemote } from './lib/receivers.mjs';
import { openSearch } from './lib/search.mjs';

// RELY.13a/AC1 — "text and controls keep enough contrast to read outdoors".
// Text contrast (4.5:1) is measured in media-app-p0-accessibility; this measures
// the other half: the boundary of a control (its border, or its fill when it has
// no border) against what is behind it must reach 3:1 (WCAG 1.4.11 non-text
// contrast) for the ordinary controls a person has to find.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(240000);
test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

async function boundaryContrast(page, selector) {
  return page.evaluate((selector) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
    });
    const lum = ({ r, g, b }) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
    const backdrop = (start) => {
      const layers = [];
      for (let n = start; n; n = n.parentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
      }
      let base = { r: 16, g: 17, b: 19, a: 1 };
      if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
      for (const l of layers.reverse()) base = over(l, base);
      return base;
    };
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true };
    const cs = getComputedStyle(el);
    const behind = backdrop(el.parentElement);
    const fillRaw = parse(cs.backgroundColor);
    const fill = fillRaw && fillRaw.a > 0 ? over(fillRaw, behind) : null;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const borderRaw = parse(cs.borderTopColor);
    const border = bw >= 1 && borderRaw && borderRaw.a > 0 && cs.borderTopStyle !== 'none' ? over(borderRaw, behind) : null;
    const candidates = [];
    if (border) candidates.push({ kind: 'border', ratio: ratio(border, behind) });
    if (fill) candidates.push({ kind: 'fill', ratio: ratio(fill, behind) });
    if (!candidates.length) return { selector, boundary: 'none (text only)' };
    const best = candidates.sort((p, q) => q.ratio - p.ratio)[0];
    return { selector, boundary: best.kind, ratio: Math.round(best.ratio * 100) / 100 };
  }, selector);
}

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[RELY.13a/AC1] ${label}: the boundary of every ordinary control reaches 3:1 against what is behind it`, async ({ browser, request }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const measured = [];
    const check = async (where, selector) => { const m = await boundaryContrast(page, selector); measured.push({ where, ...m }); };

    // Home and the dock/header controls.
    await check('home: first tile menu button', '[data-testid^="home-tile-"][data-testid$="-more"]');
    if (vp.width >= 600) {
      await check('dock: search field', '[data-testid="media-search-bar"] input');
      await check('dock: destination control', '[data-testid="cast-target-chip"]');
    } else {
      await check('dock: search launcher', '[data-testid="media-search-launcher"]');
    }
    const input = await openSearch(page, vp);
    await input.fill('Arrival');
    await check('search: scope chip', '[data-testid="scope-chip-video"]');
    // Details buttons.
    await gotoMedia(page, '/media?view=detail&contentId=plex%3A55854');
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
    for (const id of ['detail-play-now', 'detail-play-next', 'detail-up-next', 'detail-add', 'detail-favourite']) await check(`details: ${id}`, `[data-testid="${id}"]`);
    // Another screen's transport and queue controls.
    await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100, queue: [{ title: 'Next one' }] });
    await openRemote(page, SCRIPTED.POWER, vp);
    for (const id of ['np-toggle', 'np-next', 'np-rate', 'np-stop', 'queue-shuffle', 'queue-repeat', 'queue-clear', 'peek-move-to']) await check(`remote: ${id}`, `[data-testid="${id}"]`);

    const present = measured.filter((m) => !m.missing && m.ratio !== undefined);
    const failing = present.filter((m) => m.ratio < 3);
    test.info().annotations.push({ type: 'contrast', description: JSON.stringify(measured) });
    expect(present.length, `controls measured: ${JSON.stringify(measured)}`).toBeGreaterThanOrEqual(8);
    expect(failing, `control boundaries under 3:1: ${JSON.stringify(failing)}`).toEqual([]);
    await context.close();
  });
}
