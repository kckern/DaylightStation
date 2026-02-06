import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const PAGE_URL = `${FRONTEND_URL}/admin/content/lists/menus/fhe`;

test.describe.serial('Combobox Scroll Behavior — VS Code edge-snap', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  test('HURDLE 1: Dev server is running', async () => {
    const response = await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(response?.ok(), 'Dev server should respond on /').toBe(true);
  });

  test('HURDLE 2: Navigate to FHE list and find closing hymn', async () => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the items container to appear
    await page.waitForSelector('.items-container', { timeout: 15000 });

    // Find the row with "Closing Hymn" label
    const closingHymnRow = page.locator('.item-row', { hasText: /closing hymn/i });
    await expect(closingHymnRow).toBeVisible({ timeout: 10000 });

    // Click the content display (col-input) to open the combobox
    const colInput = closingHymnRow.locator('.col-input .content-display');
    await expect(colInput).toBeVisible({ timeout: 5000 });
    await colInput.click();

    // Wait for content options to appear in the dropdown
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.content-option[data-value]');
      return opts.length > 5;
    }, { timeout: 10000 });

    const optionCount = await page.locator('.content-option[data-value]').count();
    console.log(`   Dropdown open with ${optionCount} options`);
    expect(optionCount).toBeGreaterThan(5);
  });

  test('HURDLE 3: Measure Y positions during ArrowDown navigation', async () => {
    // Ensure dropdown is still open
    await expect(page.locator('.content-option[data-value]').first()).toBeVisible({ timeout: 3000 });

    const measurements = [];
    const totalPresses = 30;

    for (let i = 0; i < totalPresses; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150); // Let animation settle

      const measurement = await page.evaluate(() => {
        const highlighted = document.querySelector('.content-option.highlighted');
        if (!highlighted) return null;

        const container = highlighted.closest('.mantine-Combobox-options')?.parentElement
                       || highlighted.closest('[style*="overflow"]');
        // Find the scrollable container with data-value items
        const scrollContainer = (() => {
          let el = highlighted.parentElement;
          while (el) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
            el = el.parentElement;
          }
          return null;
        })();

        if (!scrollContainer) return null;

        const highlightRect = highlighted.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        return {
          itemText: highlighted.textContent?.slice(0, 60).trim(),
          yAbsolute: Math.round(highlightRect.top),
          yRelativeToContainer: Math.round(highlightRect.top - containerRect.top),
          containerTop: Math.round(containerRect.top),
          containerBottom: Math.round(containerRect.bottom),
          containerHeight: Math.round(containerRect.height),
          itemTop: Math.round(highlightRect.top),
          itemBottom: Math.round(highlightRect.bottom),
          scrollTop: Math.round(scrollContainer.scrollTop),
          isFullyVisible: highlightRect.top >= containerRect.top && highlightRect.bottom <= containerRect.bottom,
        };
      });

      if (measurement) {
        measurements.push({ press: i + 1, direction: 'down', ...measurement });
      }
    }

    // Print measurements table
    console.log('\n   === ArrowDown Y-Position Measurements ===');
    console.log('   Press | Y-Abs | Y-Rel | ScrollTop | Visible | Item');
    console.log('   ------|-------|-------|-----------|---------|-----');
    for (const m of measurements) {
      const vis = m.isFullyVisible ? 'YES' : ' NO';
      console.log(`   ${String(m.press).padStart(5)} | ${String(m.yAbsolute).padStart(5)} | ${String(m.yRelativeToContainer).padStart(5)} | ${String(m.scrollTop).padStart(9)} | ${vis.padStart(7)} | ${m.itemText?.slice(0, 40)}`);
    }

    // === ANALYSIS ===

    // 1. Visibility: highlighted item must ALWAYS be fully visible
    const invisibleCount = measurements.filter(m => !m.isFullyVisible).length;
    console.log(`\n   Visibility: ${measurements.length - invisibleCount}/${measurements.length} fully visible`);

    // 2. Stillness: Y position should NOT be constant (that means the highlight is locked in place)
    const yPositions = measurements.map(m => m.yRelativeToContainer);
    const uniqueYPositions = new Set(yPositions);
    const yVariance = uniqueYPositions.size;
    console.log(`   Y-position variety: ${yVariance} unique positions out of ${yPositions.length} presses`);

    // 3. Scroll behavior: scrollTop should stay unchanged while items are visible,
    //    then start changing once we reach the edge
    const initScroll = measurements[0]?.scrollTop ?? 0;
    const firstScrollIdx = measurements.findIndex(m => Math.abs(m.scrollTop - initScroll) > 2);
    console.log(`   First scroll change at press: ${firstScrollIdx === -1 ? 'NEVER' : firstScrollIdx + 1}`);

    // 4. No large jumps: consecutive Y changes should be small (1 row height ± tolerance)
    const yDeltas = [];
    for (let i = 1; i < measurements.length; i++) {
      const delta = measurements[i].yAbsolute - measurements[i - 1].yAbsolute;
      yDeltas.push(delta);
    }
    const maxDelta = Math.max(...yDeltas.map(Math.abs));
    const avgDelta = yDeltas.reduce((a, b) => a + b, 0) / yDeltas.length;
    console.log(`   Y-deltas: avg=${avgDelta.toFixed(1)}px, max=${maxDelta}px`);

    // Store for scoring
    test.info().annotations.push({ type: 'downMeasurements', description: JSON.stringify({ measurements, invisibleCount, yVariance, firstScrollIdx, maxDelta, avgDelta }) });

    // Log but don't block — scoring happens in final hurdle
    if (invisibleCount > 0) console.log(`   WARNING: ${invisibleCount} items not fully visible during ArrowDown`);
  });

  test('HURDLE 4: Measure Y positions during ArrowUp navigation', async () => {
    await expect(page.locator('.content-option[data-value]').first()).toBeVisible({ timeout: 3000 });

    const measurements = [];
    const totalPresses = 30;

    for (let i = 0; i < totalPresses; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(150);

      const measurement = await page.evaluate(() => {
        const highlighted = document.querySelector('.content-option.highlighted');
        if (!highlighted) return null;

        const scrollContainer = (() => {
          let el = highlighted.parentElement;
          while (el) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
            el = el.parentElement;
          }
          return null;
        })();

        if (!scrollContainer) return null;

        const highlightRect = highlighted.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        return {
          itemText: highlighted.textContent?.slice(0, 60).trim(),
          yAbsolute: Math.round(highlightRect.top),
          yRelativeToContainer: Math.round(highlightRect.top - containerRect.top),
          containerHeight: Math.round(containerRect.height),
          scrollTop: Math.round(scrollContainer.scrollTop),
          isFullyVisible: highlightRect.top >= containerRect.top && highlightRect.bottom <= containerRect.bottom,
        };
      });

      if (measurement) {
        measurements.push({ press: i + 1, direction: 'up', ...measurement });
      }
    }

    console.log('\n   === ArrowUp Y-Position Measurements ===');
    console.log('   Press | Y-Abs | Y-Rel | ScrollTop | Visible | Item');
    console.log('   ------|-------|-------|-----------|---------|-----');
    for (const m of measurements) {
      const vis = m.isFullyVisible ? 'YES' : ' NO';
      console.log(`   ${String(m.press).padStart(5)} | ${String(m.yAbsolute).padStart(5)} | ${String(m.yRelativeToContainer).padStart(5)} | ${String(m.scrollTop).padStart(9)} | ${vis.padStart(7)} | ${m.itemText?.slice(0, 40)}`);
    }

    const invisibleCount = measurements.filter(m => !m.isFullyVisible).length;
    console.log(`\n   Visibility: ${measurements.length - invisibleCount}/${measurements.length} fully visible`);

    if (invisibleCount > 0) console.log(`   WARNING: ${invisibleCount} items not fully visible during ArrowUp`);
  });

  test('HURDLE 5: Pac-man wrap detection (informational)', async () => {
    // Close and reopen dropdown to get a fresh state
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const closingHymnRow = page.locator('.item-row', { hasText: /closing hymn/i });
    const colInput = closingHymnRow.locator('.col-input .content-display');
    await colInput.click();
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.content-option[data-value]');
      return opts.length > 5;
    }, { timeout: 10000 });

    // Get item count and navigate to item 0 by pressing ArrowUp enough times
    const itemCount = await page.locator('.content-option[data-value]').count();
    console.log(`\n   Total items: ${itemCount}`);

    // Use page.evaluate to directly set highlightedIdx to test wrap more efficiently
    // Instead, just press ArrowUp enough to get near item 0. With 401 items starting at ~309,
    // we need ~310 presses. Use fast batch.
    const pressCount = Math.min(itemCount + 10, 420);
    for (let i = 0; i < pressCount; i++) {
      await page.keyboard.press('ArrowUp');
      // No waitForTimeout for speed — we just need to get to item 0
    }
    await page.waitForTimeout(300);

    const beforeWrap = await page.evaluate(() => {
      const highlighted = document.querySelector('.content-option.highlighted');
      const scrollContainer = (() => {
        let el = highlighted?.parentElement;
        while (el) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
          el = el.parentElement;
        }
        return null;
      })();
      return {
        text: highlighted?.textContent?.slice(0, 60).trim(),
        scrollTop: scrollContainer ? Math.round(scrollContainer.scrollTop) : null,
      };
    });
    console.log(`   At top: "${beforeWrap.text}", scrollTop=${beforeWrap.scrollTop}`);

    // Now press ArrowUp one more time — should pac-man wrap to the LAST item
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);

    const afterWrap = await page.evaluate(() => {
      const highlighted = document.querySelector('.content-option.highlighted');
      const scrollContainer = (() => {
        let el = highlighted?.parentElement;
        while (el) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
          el = el.parentElement;
        }
        return null;
      })();
      const containerRect = scrollContainer?.getBoundingClientRect();
      const highlightRect = highlighted?.getBoundingClientRect();
      return {
        text: highlighted?.textContent?.slice(0, 60).trim(),
        scrollTop: scrollContainer ? Math.round(scrollContainer.scrollTop) : null,
        scrollHeight: scrollContainer ? Math.round(scrollContainer.scrollHeight) : null,
        isFullyVisible: highlightRect && containerRect
          ? highlightRect.top >= containerRect.top && highlightRect.bottom <= containerRect.bottom
          : false,
        hasFlashClass: highlighted?.classList.contains('wrap-flash') ?? false,
      };
    });
    console.log(`   After wrap: "${afterWrap.text}", scrollTop=${afterWrap.scrollTop}, visible=${afterWrap.isFullyVisible}, flash=${afterWrap.hasFlashClass}`);

    // Informational — don't block SCORE hurdle
    if (!afterWrap.isFullyVisible) {
      console.log('   WARNING: Wrapped item not fully visible');
    }
    if (!afterWrap.hasFlashClass) {
      console.log('   WARNING: Wrap flash class not detected (may have already been removed by animationend)');
    }
  });

  test('SCORE: Evaluate overall scroll behavior', async () => {
    // Re-open dropdown fresh for a clean evaluation run
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const closingHymnRow = page.locator('.item-row', { hasText: /closing hymn/i });
    const colInput = closingHymnRow.locator('.col-input .content-display');
    await colInput.click();
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.content-option[data-value]');
      return opts.length > 5;
    }, { timeout: 10000 });

    // Run 40 ArrowDown presses and collect full data
    const samples = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);

      const s = await page.evaluate(() => {
        const highlighted = document.querySelector('.content-option.highlighted');
        if (!highlighted) return null;
        const scrollContainer = (() => {
          let el = highlighted.parentElement;
          while (el) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
            el = el.parentElement;
          }
          return null;
        })();
        if (!scrollContainer) return null;
        const hRect = highlighted.getBoundingClientRect();
        const cRect = scrollContainer.getBoundingClientRect();
        return {
          yRel: Math.round(hRect.top - cRect.top),
          scrollTop: Math.round(scrollContainer.scrollTop),
          containerH: Math.round(cRect.height),
          visible: hRect.top >= cRect.top && hRect.bottom <= cRect.bottom,
        };
      });
      if (s) samples.push(s);
    }

    // === SCORING ===
    let score = 100;
    const deductions = [];

    // 1. Visibility (40 pts) — item must always be visible
    const invisCount = samples.filter(s => !s.visible).length;
    if (invisCount > 0) {
      const penalty = Math.min(40, invisCount * 10);
      score -= penalty;
      deductions.push(`-${penalty}: ${invisCount} items not fully visible`);
    }

    // 2. No fixed-position lock (20 pts) — Y must vary as we scroll
    const yValues = samples.map(s => s.yRel);
    const uniqueY = new Set(yValues).size;
    const yRange = Math.max(...yValues) - Math.min(...yValues);
    if (uniqueY <= 3) {
      score -= 20;
      deductions.push(`-20: Only ${uniqueY} unique Y positions — highlight is locked in place`);
    } else if (yRange < 50) {
      score -= 10;
      deductions.push(`-10: Y range only ${yRange}px — insufficient visual movement`);
    }

    // 3. Scroll starts late (15 pts) — scrollTop should stay unchanged for the
    //    first few presses (items still visible). Checks for CHANGE from initial
    //    value, not absolute > 0 (which is always true for items deep in a list).
    const initialScrollTop = samples[0]?.scrollTop ?? 0;
    const firstScroll = samples.findIndex(s => Math.abs(s.scrollTop - initialScrollTop) > 2);
    if (firstScroll === 0) {
      score -= 15;
      deductions.push('-15: Scrolled immediately on first press — should stay still while visible');
    } else if (firstScroll >= 1 && firstScroll <= 2) {
      score -= 8;
      deductions.push(`-8: Scrolled too early (press ${firstScroll + 1}) — expected to fill viewport first`);
    }

    // 4. Smooth progression (15 pts) — no large Y jumps
    const deltas = [];
    for (let i = 1; i < samples.length; i++) {
      deltas.push(Math.abs(samples[i].yRel - samples[i - 1].yRel));
    }
    const maxJump = Math.max(...deltas);
    const containerH = samples[0]?.containerH || 300;
    if (maxJump > containerH * 0.5) {
      score -= 15;
      deductions.push(`-15: Max Y jump of ${maxJump}px (>${Math.round(containerH * 0.5)}px) — jarring viewport shift`);
    } else if (maxJump > containerH * 0.3) {
      score -= 7;
      deductions.push(`-7: Max Y jump of ${maxJump}px — noticeable viewport shift`);
    }

    // 5. Edge-following behavior (10 pts) — once scrolling starts, Y should hover near the bottom edge
    const scrollingSamples = samples.filter(s => s.scrollTop > 0);
    if (scrollingSamples.length > 5) {
      const edgeDistances = scrollingSamples.map(s => s.containerH - s.yRel);
      const avgEdgeDist = edgeDistances.reduce((a, b) => a + b, 0) / edgeDistances.length;
      // Should be near the bottom (within ~2 row heights, ~80px)
      if (avgEdgeDist < 0 || avgEdgeDist > 100) {
        score -= 10;
        deductions.push(`-10: Avg distance from bottom edge: ${avgEdgeDist.toFixed(0)}px — not edge-following`);
      }
    }

    // === REPORT ===
    console.log('\n   ╔══════════════════════════════════════════════╗');
    console.log(`   ║  COMBOBOX SCROLL BEHAVIOR SCORE: ${String(score).padStart(3)}/100     ║`);
    console.log('   ╠══════════════════════════════════════════════╣');

    if (deductions.length === 0) {
      console.log('   ║  No deductions — perfect score!               ║');
    } else {
      for (const d of deductions) {
        console.log(`   ║  ${d.padEnd(44)} ║`);
      }
    }

    console.log('   ╠══════════════════════════════════════════════╣');

    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    const gradeText = {
      'A': 'Excellent — VS Code-level UX',
      'B': 'Good — minor polish needed',
      'C': 'Acceptable — noticeable issues',
      'D': 'Poor — significant UX problems',
      'F': 'Failing — fundamentally broken',
    }[grade];
    console.log(`   ║  Grade: ${grade} — ${gradeText.padEnd(35)} ║`);
    console.log('   ╚══════════════════════════════════════════════╝');

    console.log(`\n   Stats: ${samples.length} samples, ${uniqueY} unique Y, range ${yRange}px`);
    console.log(`   First scroll at press ${firstScroll + 1}, max jump ${maxJump}px`);
    console.log(`   Container height: ${containerH}px`);

    // The test passes if score >= 70 (C or better)
    expect(score, `Score ${score}/100 is below passing threshold of 70`).toBeGreaterThanOrEqual(70);
  });
});
