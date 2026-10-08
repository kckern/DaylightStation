import { test, expect } from '@playwright/test';
import { SIZES, smallTargets, offscreenControls, noHorizontalScroll, contrastOf, layoutShiftDuring } from './lib/a11yProbe.mjs';
import { freshPage, isPhone, playArrivalHere, searchFor, skipFirstUse } from './lib/mediaDriver.mjs';
import { resetHouseholdAt } from './lib/household.mjs';

// Task 8 — accessibility and size parity (RELY.11a, RELY.12a, RELY.13a, NF-A11Y,
// NF-DEV). Everything is measured from the live page with ordinary pointer and
// keyboard input at phone, tablet and laptop sizes (and the 360 px floor).
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 20000 });
test.setTimeout(180000);

const fmt = (list) => list.map((x) => `${x.id ?? x.name} ${x.w}x${x.h}`).join('; ');

for (const [size, viewport] of SIZES) {
  test.describe(size, () => {
    test.use({ viewport });

    test(`[RELY.11a][NF-DEV-02] ${size}: every main action is in the viewport and a 44px target, in every state`, async ({ page }) => {
      await freshPage(page);
      await expect(page.getByTestId('first-use-card')).toBeVisible({ timeout: 30000 });
      // Home, first use, with the aim explained.
      expect(await smallTargets(page), 'home: ').toEqual([]);
      const phone = isPhone(page);
      expect(await offscreenControls(page, [
        phone ? '[data-testid="media-search-launcher"]' : '[data-testid="media-search-bar"] input, input[placeholder="Search media…"]',
        // The destination control is the header's always-present control; the house
        // indicator appears only while something plays, so it is not a fixed fixture.
        '[data-testid="cast-target-chip"]', '[data-testid="settings-menu-trigger"]',
        phone ? '[data-testid="app-tab-home"]' : '[data-testid="app-nav-home"]',
        phone ? '[data-testid="app-tab-fleet"]' : '[data-testid="app-nav-fleet"]',
      ])).toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);
      // The naming popover is an overlay that never hides search: the launcher is
      // clickable (not intercepted) while it is still open.
      if (phone) {
        const launcher = page.getByTestId('media-search-launcher');
        const lb = await launcher.boundingBox();
        const cb = await page.getByTestId('first-use-card').boundingBox();
        expect(cb.y >= lb.y + lb.height || cb.y + cb.height <= lb.y, 'first-use card overlaps the search launcher').toBe(true);
        await launcher.click({ trial: true });
      }
      await skipFirstUse(page);

      // Search open, with results (incl. the row action icons and the aim line).
      await searchFor(page, 'Arrival');
      const searching = await smallTargets(page);
      expect(searching, `search: ${fmt(searching)}`).toEqual([]);
      if (phone) await page.getByRole('button', { name: 'Close search' }).click(); else await page.keyboard.press('Escape');

      // Playing: handle, outcome row (Undo), controls.
      await playArrivalHere(page);
      await expect(page.getByTestId('mini-toggle')).toBeVisible();
      const playing = await smallTargets(page);
      expect(playing, `playing: ${fmt(playing)}`).toEqual([]);
      expect(await offscreenControls(page, ['[data-testid="mini-toggle"]', '[data-testid="mini-next"]', '[data-testid="mini-stop"]', '[data-testid="mini-player-open-nowplaying"]'])).toEqual([]);

      // Now Playing: transport, queue editing, the several-screens picker.
      await page.getByTestId('mini-player-open-nowplaying').click();
      await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
      const np = await smallTargets(page);
      expect(np, `now playing: ${fmt(np)}`).toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);

      // A portalled menu (Settings) and a dialog (Start fresh) hold the same floor.
      await page.getByTestId('settings-menu-trigger').click();
      await expect(page.getByTestId('settings-menu-panel')).toBeVisible();
      const menu = await smallTargets(page, { scope: '[data-testid="settings-menu-panel"]' });
      expect(menu, `settings menu: ${fmt(menu)}`).toEqual([]);
      await page.getByTestId('settings-reset-session').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const dlg = await smallTargets(page, { scope: '[role="dialog"]' });
      expect(dlg, `dialog: ${fmt(dlg)}`).toEqual([]);
      // Esc dismisses the dialog; the person is back where they were.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    test(`[RELY.11a/AC2][RELY.11a/AC3] ${size}: one polite announcement per outcome, ticking values hidden, fleet status in words`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      const announcer = page.getByTestId('media-outcome-announcer');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');
      await expect(announcer).toContainText('Arrival', { timeout: 10000 });
      // The visible row is not a second live region for the same words.
      const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"]')]
        .filter((el) => /Arrival here/.test(el.textContent ?? '')).map((el) => el.getAttribute('data-testid') ?? el.className));
      expect(live, `live regions carrying the outcome: ${live.join(', ')}`).toHaveLength(1);
      // Anything that ticks (a time left, a progress value) is out of the accessibility tree.
      const ticking = await page.evaluate(() => [...document.querySelectorAll('[data-testid="mini-sleep"], [data-testid="screen-next-countdown-seconds"]')]
        .filter((el) => el.getAttribute('aria-hidden') !== 'true').map((el) => el.getAttribute('data-testid')));
      expect(ticking).toEqual([]);

      // Fleet: every device states its condition in words, never by a coloured dot alone.
      await page.getByTestId(isPhone(page) ? 'app-tab-fleet' : 'app-nav-fleet').click();
      await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 20000 });
      const cards = page.locator('[data-testid^="fleet-card-"]');
      await expect.poll(() => cards.count(), { timeout: 20000 }).toBeGreaterThan(1);
      const states = await page.locator('[data-testid^="fleet-state-"]').allTextContents();
      expect(states.length).toBe(await cards.count());
      for (const text of states) expect(text.trim(), 'fleet state text').toMatch(/^(Playing|Paused|Idle|Off|Uncertain|Starting|Buffering|Having trouble|Something went wrong|Not reporting)/);
    });

    test(`[RELY.11a/AC1] ${size}: text at 200% reflows without clipping, overlap or a sideways page`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(500);
      expect(await noHorizontalScroll(page), 'page scrolls sideways at 200% text').toBe(true);
      // The handle's controls are all still on screen and none sits on another.
      const ids = ['mini-toggle', 'mini-next', 'mini-stop', 'mini-player-open-nowplaying'];
      const boxes = [];
      for (const id of ids) {
        const b = await page.getByTestId(id).boundingBox();
        expect(b, `${id} laid out`).toBeTruthy();
        expect(b.x).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize().width + 0.5);
        boxes.push([id, b]);
      }
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const [ai, a] = boxes[i]; const [bi, b] = boxes[j];
        const overlap = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
        expect(overlap, `${ai} overlaps ${bi}`).toBe(false);
      }
      // Text is clipped only by ellipsis, never by a hidden overflow with no way to read it:
      // the title is reachable through the handle's accessible name.
      await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveAttribute('aria-label', /Arrival/);
      // The primary navigation is still all there.
      for (const area of ['home', 'browse', 'fleet']) {
        await expect(page.getByTestId(`${isPhone(page) ? 'app-tab' : 'app-nav'}-${area}`)).toBeVisible();
      }
    });

    test(`[NF-A11Y-04] ${size}: reduced motion removes the shell's own transitions and animations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      await page.getByTestId('settings-menu-trigger').click();
      await expect(page.getByTestId('settings-menu-panel')).toBeVisible();
      // The hand-rolled spinners (send tray, "still searching") only exist while work is
      // in flight, which is too brief to catch; mount the real class names in the shell so
      // the stylesheet rule is what is measured.
      await page.evaluate(() => {
        const host = document.querySelector('.media-shell') ?? document.body;
        const tray = document.createElement('span');
        tray.className = 'cast-tray-spinner'; tray.setAttribute('data-probe-spinner', 'cast-tray-spinner');
        host.appendChild(tray);
        // "Still searching" is styled only inside its own row.
        const row = document.createElement('div');
        row.className = 'search-still-searching';
        const spin = document.createElement('span');
        spin.className = 'search-still-searching-spinner'; spin.setAttribute('data-probe-spinner', 'search-still-searching-spinner');
        row.appendChild(spin); host.appendChild(row);
      });
      const spinners = await page.evaluate(() => [...document.querySelectorAll('[data-probe-spinner]')].map((el) => {
        const cs = getComputedStyle(el);
        return { cls: el.getAttribute('data-probe-spinner'), name: cs.animationName, dur: cs.animationDuration, iter: cs.animationIterationCount };
      }));
      for (const sp of spinners) {
        expect(sp.name, `${sp.cls} animation`).not.toBe('none');
        expect(parseFloat(sp.dur), `${sp.cls} still turns under reduced motion`).toBeGreaterThan(0.1);
        expect(sp.iter, `${sp.cls} keeps looping`).toBe('infinite');
      }
      const moving = await page.evaluate(() => {
        const secs = (v) => Math.max(0, ...String(v).split(',').map((x) => parseFloat(x) || 0)) * (/ms\b/.test(v) ? 0.001 : 1);
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          // Loading indicators keep turning on purpose: a frozen spinner reads as a hang.
          if (el.closest('.mantine-Loader-root, [role="progressbar"], .loading-overlay, [data-probe-spinner]')) continue;
          const cs = getComputedStyle(el);
          const t = Math.max(...cs.transitionDuration.split(',').map((x) => (x.includes('ms') ? parseFloat(x) / 1000 : parseFloat(x)) || 0));
          const a = cs.animationName !== 'none'
            ? Math.max(...cs.animationDuration.split(',').map((x) => (x.includes('ms') ? parseFloat(x) / 1000 : parseFloat(x)) || 0)) : 0;
          if (t > 0.02 || a > 0.02) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} t=${t} a=${a}`);
        }
        return out;
      });
      expect(moving, `moving under reduced motion: ${moving.slice(0, 8).join(' | ')}`).toEqual([]);
    });
  });
}

// ---- Keyboard, dismissal, shift, contrast, reach (size-specific where it matters) ----
const FOCUS_RING = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  // A control may show its ring on a wrapper (the seek track, a chip's parent).
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const wrapped = parent && ((parent.outlineStyle !== 'none' && parseFloat(parent.outlineWidth) > 0) || (parent.boxShadow && parent.boxShadow !== 'none'));
  return {
    tag: el.tagName.toLowerCase(), id: el.getAttribute('data-testid'),
    name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30),
    ring: !!(outline || shadow || wrapped),
    inView: r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1,
  };
};

for (const [size, viewport] of SIZES) {
  test.describe(`${size} keyboard`, () => {
    test.use({ viewport });

    test(`[NF-DEV-03][NF-A11Y-01] ${size}: Tab reaches every control in order with a visible focus ring; Esc dismisses menu and dialog and returns focus`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      await page.mouse.click(2, 2);
      const seen = [];
      // Home lists many tiles before the handle in tab order, so walk until the handle's last stop
      // (bounded), then a few more stops to see what follows it.
      let afterStop = 0;
      for (let i = 0; i < 160 && afterStop < 3; i += 1) {
        await page.keyboard.press('Tab');
        // A focused tile in a sideways row scrolls into view (snapping, asynchronously): measure once it has settled.
        await page.evaluate(() => new Promise((resolve) => {
          let last = null; let still = 0;
          const tick = () => {
            const r = document.activeElement?.getBoundingClientRect?.();
            const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${document.activeElement.closest('.home-row-scroll')?.scrollLeft ?? ''}` : '';
            still = key === last ? still + 1 : 0; last = key;
            if (still >= 10) resolve(); else requestAnimationFrame(tick);
          };
          tick();
        }));
        const info = await page.evaluate(FOCUS_RING);
        if (info) seen.push(info);
        if (seen.some((x) => x.id === 'mini-stop')) afterStop += 1;
      }
      const withoutRing = seen.filter((x) => !x.ring);
      expect(withoutRing, `focus without a visible ring: ${withoutRing.map((x) => x.id ?? x.name).join(', ')}`).toEqual([]);
      const offscreen = seen.filter((x) => !x.inView);
      expect(offscreen, `focus landed out of view: ${offscreen.map((x) => x.id ?? x.name).join(', ')}`).toEqual([]);
      // The handle's controls are in the tab order, after the page and before the primary navigation.
      const ids = seen.map((x) => x.id);
      // (Next is disabled for a one-item queue, so it is correctly not a tab stop.)
      for (const want of ['mini-toggle', 'mini-stop']) expect(ids, `tab order reaches ${want}`).toContain(want);
      expect(ids).not.toContain('mini-next');
      expect(ids.indexOf('mini-toggle')).toBeLessThan(ids.indexOf('mini-stop'));

      // Menu: Enter opens it from the keyboard, Esc closes it and focus returns to its trigger.
      const trigger = page.getByTestId('settings-menu-trigger');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('settings-menu-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('settings-menu-panel')).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // Dialog: opens from the menu, Esc closes it, Cancel closes it, focus returns to the page.
      for (const via of ['escape', 'button']) {
        await trigger.click();
        await page.getByTestId('settings-reset-session').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        if (via === 'escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
        // Nothing was cleared by dismissing it.
        await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival');
      }
    });
  });
}

test.describe('keyboard shortcut', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('[NF-DEV-03] "/" focuses search from anywhere on a laptop', async ({ page }) => {
    await freshPage(page);
    await skipFirstUse(page);
    await page.mouse.click(700, 600);
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeFocused();
  });
});

test.describe('keyboard shortcut (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('[NF-DEV-03] "/" opens search on a phone with a keyboard attached', async ({ page }) => {
    await freshPage(page);
    await skipFirstUse(page);
    await page.mouse.click(200, 500);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search media', exact: true })).toBeVisible();
  });
});

test.describe('floor and navigation names', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('[NF-DEV-01] 360 px: no sideways page, controls in view at 44px, Back names where it goes', async ({ page }) => {
    await freshPage(page);
    await skipFirstUse(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    await playArrivalHere(page);
    // The house indicator appears once the house is playing (it hides at 0).
    await expect(page.getByTestId('house-indicator')).toBeVisible({ timeout: 45000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await offscreenControls(page, ['[data-testid="mini-toggle"]', '[data-testid="mini-next"]', '[data-testid="mini-stop"]', '[data-testid="media-search-launcher"]', '[data-testid="house-indicator"]'])).toEqual([]);
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
    // Back is labelled with the place it returns to, and does return there.
    const back = page.locator('.np-back-btn');
    await expect(back).toHaveText(/Home/);
    await back.click();
    await expect(page.getByTestId('home-browse')).toBeVisible();
  });
});

for (const [size, viewport] of SIZES) {
  test.describe(`${size} legibility and stability`, () => {
    test.use({ viewport });

    test(`[RELY.13a] ${size}: text and confirmations keep 4.5:1 contrast; the aim label reads at 14px or more`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      const phone = isPhone(page);
      // The house indicator appears once the house is playing (it hides at 0).
      await expect(page.getByTestId('house-indicator')).toBeVisible({ timeout: 45000 });
      // Every probe is present at every size once something is playing; an absent one fails.
      const probes = [
        '[data-testid="mini-player-open-nowplaying"] .mini-player-title-text',
        '[data-testid="house-indicator"]',
        phone ? '[data-testid="app-tab-home"] .media-nav-label' : '[data-testid="app-nav-home"] .media-nav-label',
        '[data-testid="home-browse"]',
      ];
      const failures = [];
      for (const sel of probes) {
        const r = await contrastOf(page, sel);
        if (r.missing) { failures.push(`${sel} not found`); continue; }
        if (r.ratio < 4.5) failures.push(`${sel} ${r.ratio} (${r.fg} on ${r.bg})`);
      }
      // Open Now Playing: its aim line is the arm's-length label.
      await page.getByTestId('mini-player-open-nowplaying').click();
      await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
      // The phone repeats the aim inside Now Playing (thumb reach); wider screens read it from the header control.
      const aimSel = isPhone(page) ? '[data-testid="destination-line"]' : '[data-testid="destination-control-name"]';
      for (const sel of [aimSel, '[data-testid="queue-shuffle"]']) {
        const r = await contrastOf(page, sel);
        if (r.missing) { failures.push(`${sel} not found`); continue; }
        if (r.ratio < 4.5) failures.push(`${sel} ${r.ratio} (${r.fg} on ${r.bg})`);
      }
      const aim = isPhone(page)
        ? page.locator('.now-playing-view').getByTestId('destination-line')
        : page.getByTestId('destination-control-name');
      await expect(aim).toHaveCount(1);
      const fontSize = await aim.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      if (fontSize < 14) failures.push(`aim label font-size ${fontSize}px`);
      expect(failures, `low contrast / small: ${failures.join(' | ')}`).toEqual([]);
    });

    test(`[RELY.1a/NF] ${size}: a confirmation appearing and leaving moves nothing on the page`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      await playArrivalHere(page);
      const row = page.locator('[data-testid^="dispatch-row-"]').first();
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('mini-player-video-dock').or(page.getByTestId('mini-toggle'))).toBeVisible();
      await page.waitForTimeout(1000);
      const shift = await layoutShiftDuring(page, async () => {
        await expect(row).toHaveCount(0, { timeout: 25000 });
      });
      expect(shift, `layout shift while the confirmation left: ${shift}`).toBeLessThan(0.02);
    });
  });
}

test.describe('one-thumb reach (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  // The top 40% of a tall phone is out of a one-handed thumb's comfortable arc.
  // Search, Play/Pause and the aim (where it can be changed on a phone) must
  // each be reachable in the lower 60%, and none may need a second hand
  // (no multi-finger gesture, no press-and-hold: every one is a single tap).
  test('[RELY.12a] search, play/pause and the aim are all within the lower 60% of the screen', async ({ page }) => {
    await freshPage(page);
    await skipFirstUse(page);
    const lowerZone = page.viewportSize().height * 0.4;
    const centreY = async (locator) => { const b = await locator.boundingBox(); expect(b).toBeTruthy(); return b.y + b.height / 2; };

    // Search: the tab bar carries it.
    const searchTab = page.getByTestId('app-tab-search');
    await expect(searchTab).toBeVisible();
    expect(await centreY(searchTab), 'Search tab centre y').toBeGreaterThan(lowerZone);
    await searchTab.click();
    await expect(page.getByRole('searchbox', { name: 'Search media', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close search' }).click();

    // Play/pause on the handle.
    await playArrivalHere(page);
    expect(await centreY(page.getByTestId('mini-toggle')), 'play/pause centre y').toBeGreaterThan(lowerZone);

    // The aim on Now Playing, and the picker it opens, are in reach too.
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
    const aim = page.locator('.now-playing-view').getByTestId('destination-line');
    await expect(aim).toBeVisible();
    expect(await centreY(aim), 'aim label centre y').toBeGreaterThan(lowerZone);
    await aim.click();
    const picker = page.getByRole('dialog').getByTestId('dispatch-target-picker');
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox.y + pickerBox.height / 2, 'picker centre y').toBeGreaterThan(lowerZone);
  });
});

for (const [size, viewport] of SIZES) {
  test.describe(`${size} first visit`, () => {
    test.use({ viewport });
    // The acceptance server's household is seeded; this journey is about the empty one.
    test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL, { empty: true }); });
    test.afterEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });
    test(`[RELY.14a/AC3] ${size}: a household with nothing played yet is offered a way into browsing by kind`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      // Nothing has been played on this device: no handle, no resume card.
      await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
      const browse = page.getByTestId('home-browse');
      await expect(browse).toBeVisible({ timeout: 30000 });
      expect(await offscreenControls(page, ['[data-testid="home-browse"]'])).toEqual([]);
      await browse.click();
      await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid^="browse-row-"]').first()).toBeVisible({ timeout: 30000 });
    });
  });
}

for (const [size, viewport] of SIZES) {
  test.describe(`${size} every view`, () => {
    test.use({ viewport });
    test(`[NF-A11Y-02][NF-DEV-02] ${size}: Browse, Devices, Remote, Screens, Routines and the sleep timer hold the 44px floor and fit the width`, async ({ page }) => {
      await freshPage(page);
      await skipFirstUse(page);
      const check = async (label) => {
        const small = await smallTargets(page);
        expect(small, `${label}: ${fmt(small)}`).toEqual([]);
        expect(await noHorizontalScroll(page), `${label}: sideways scroll`).toBe(true);
      };
      const phone = isPhone(page);
      await playArrivalHere(page);

      await page.getByTestId(phone ? 'app-tab-browse' : 'app-nav-browse').click();
      await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid^="browse-row-"]').first()).toBeVisible({ timeout: 30000 });
      await check('browse');

      await page.getByTestId(phone ? 'app-tab-fleet' : 'app-nav-fleet').click();
      await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 20000 });
      await expect.poll(() => page.locator('[data-testid^="fleet-card-"]').count(), { timeout: 30000 }).toBeGreaterThan(0);
      await check('devices');

      // A screen's Remote, with the sleep timer menu open (a portalled menu of options).
      await page.locator('[data-testid^="fleet-peek-"]').first().click();
      await expect(page.getByTestId('session-controls-panel')).toBeVisible({ timeout: 20000 });
      await check('remote');
      await page.getByTestId('mini-player-open-nowplaying').click();
      await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-testid="sleep-timer-button"]:visible').first().click();
      await expect(page.getByTestId('sleep-timer-menu')).toBeVisible();
      const sleep = await smallTargets(page, { scope: '[data-testid="sleep-timer-menu"]' });
      expect(sleep, `sleep timer menu: ${fmt(sleep)}`).toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByTestId('settings-menu-trigger').click();
      await page.getByTestId('settings-manage-screens').click();
      await expect(page.getByTestId('screen-admin-view')).toBeVisible({ timeout: 20000 });
      await check('screens');
      await page.getByTestId('settings-menu-trigger').click();
      await page.getByTestId('settings-routine-history').click();
      await expect(page.getByTestId('routine-history-view').or(page.getByTestId('routines-view'))).toBeVisible({ timeout: 20000 });
      await check('routines');
    });
  });
}
