/**
 * Chart Y-Scale Linear Mode Test
 *
 * Verifies that single-user sessions use linear Y-scale with evenly distributed gridlines.
 *
 * Requirement: When only 1 user is in the session (historically), the chart should:
 * - Use linear Y-scale (not logarithmic)
 * - Display horizontal gridlines at even vertical intervals
 *
 * Usage:
 *   npx playwright test tests/runtime/chart/chart-yscale-linear.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  clearDevLog,
  readDevLog
} from '../fitness-session/fitness-test-utils.mjs';
import {
  FitnessTestSimulator
} from '#fixtures/fitness/FitnessTestSimulator.mjs';
import { FRONTEND_URL, WS_URL } from '#fixtures/runtime/urls.mjs';

const HEALTH_ENDPOINT = `${FRONTEND_URL}/api/fitness`;

// Acceptable margin of error for gridline spacing (pixels)
const SPACING_TOLERANCE_PX = 5;
// Acceptable margin as percentage of expected spacing
const SPACING_TOLERANCE_PCT = 0.10; // 10%

/**
 * Helper: Extract gridline Y positions from the chart SVG
 * Excludes the bottom axis line (which is added separately after yTicks)
 */
async function getGridlineYPositions(page) {
  return page.evaluate(() => {
    // Find the race chart SVG
    const svg = document.querySelector('.race-chart__svg');
    if (!svg) return { error: 'No chart SVG found' };

    // Get horizontal gridlines from the grid group
    const gridGroup = svg.querySelector('.race-chart__grid');
    if (!gridGroup) return { error: 'No grid group found' };

    const gridlines = gridGroup.querySelectorAll('line');
    const yPositions = [];

    gridlines.forEach(line => {
      const y1 = parseFloat(line.getAttribute('y1'));
      const y2 = parseFloat(line.getAttribute('y2'));
      // Horizontal lines have y1 === y2
      if (Math.abs(y1 - y2) < 1) {
        yPositions.push(y1);
      }
    });

    // Sort by Y position (top to bottom)
    yPositions.sort((a, b) => a - b);

    // INCLUDE the X-axis as a gridline!
    // For linear scale (single user), gridlines should be evenly distributed
    // from the top of the chart all the way down to the X-axis.
    // The X-axis line is at height - CHART_MARGIN.bottom and MUST be included
    // to verify even distribution across the full chart height.

    return {
      positions: yPositions,
      count: yPositions.length
    };
  });
}

/**
 * Helper: Check if gridlines are evenly spaced
 */
function checkEvenSpacing(positions, tolerancePx, tolerancePct) {
  if (positions.length < 2) {
    return { isLinear: false, reason: 'Not enough gridlines to measure spacing' };
  }

  // Calculate spacing between consecutive gridlines
  const spacings = [];
  for (let i = 1; i < positions.length; i++) {
    spacings.push(positions[i] - positions[i - 1]);
  }

  // Calculate expected spacing (average)
  const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;

  // Check each spacing against the average
  const deviations = spacings.map((spacing, idx) => {
    const deviation = Math.abs(spacing - avgSpacing);
    const deviationPct = deviation / avgSpacing;
    return {
      index: idx,
      spacing,
      deviation,
      deviationPct,
      withinTolerance: deviation <= tolerancePx || deviationPct <= tolerancePct
    };
  });

  const allWithinTolerance = deviations.every(d => d.withinTolerance);
  const maxDeviation = Math.max(...deviations.map(d => d.deviation));
  const maxDeviationPct = Math.max(...deviations.map(d => d.deviationPct));

  return {
    isLinear: allWithinTolerance,
    avgSpacing,
    spacings,
    deviations,
    maxDeviation,
    maxDeviationPct,
    reason: allWithinTolerance
      ? 'Gridlines are evenly spaced (linear scale)'
      : `Spacing varies by ${maxDeviation.toFixed(1)}px (${(maxDeviationPct * 100).toFixed(1)}%) - not linear`
  };
}

test.describe.serial('Chart Y-Scale Linear Mode', () => {
  /** @type {FitnessTestSimulator} */
  let simulator;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    await clearDevLog();
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (simulator) {
      simulator.stopSimulation();
      simulator.disconnect();
    }
    if (page) await page.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Health Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const response = await fetch(HEALTH_ENDPOINT).catch(() => null);
    expect(response?.ok, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 2: Simulator Connection (Single User)
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Connect simulator with SINGLE user', async () => {
    console.log('\n🏃 HURDLE 2: Connecting simulator with single user...');

    simulator = new FitnessTestSimulator({
      wsUrl: WS_URL,
      verbose: true,
      updateInterval: 2000
    });

    await simulator.connect();
    expect(simulator.connected, 'Simulator failed to connect').toBe(true);

    // Start simulation with ONLY ONE user
    simulator.runScenario({
      duration: 120,
      users: {
        alice: { hr: 110, variance: 5 }  // Single user in active zone
      }
    });

    console.log('   Single user "alice" simulating at 110 bpm');
    console.log('✅ HURDLE 2 PASSED: Single-user simulation started\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Load Fitness Page
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Fitness page loads', async () => {
    console.log('\n🏃 HURDLE 3: Loading fitness page...');

    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');

    const navbar = page.locator('.fitness-navbar');
    await expect(navbar, 'Fitness page did not render').toBeVisible({ timeout: 10000 });

    console.log('✅ HURDLE 3 PASSED: Fitness page loaded\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Open Chart View
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Open chart view by clicking device-container', async () => {
    console.log('\n🏃 HURDLE 4: Opening chart view...');

    // Click the device-container to activate the chart view
    const deviceContainer = page.locator('.device-container').first();

    await expect(deviceContainer, 'Device container not found').toBeVisible({ timeout: 10000 });
    await deviceContainer.click();
    console.log('   Clicked device-container to open chart view');

    await page.waitForTimeout(2000);
    console.log('✅ HURDLE 4 PASSED: Chart view opened\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 5: Wait for Chart to Render with Data
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 5: Chart renders with single-user data', async () => {
    console.log('\n🏃 HURDLE 5: Waiting for chart to render...');

    // Wait for timeline data to accumulate (need multiple ticks for meaningful chart)
    console.log('   Waiting 15s for timeline data to accumulate...');
    await page.waitForTimeout(15000);

    // Check for chart SVG
    const chartSvg = page.locator('.race-chart__svg');
    await expect(chartSvg, 'Chart SVG not found').toBeVisible({ timeout: 10000 });

    // Check for at least one path (user's line)
    const paths = page.locator('.race-chart__paths path');
    const pathCount = await paths.count();
    console.log(`   Chart paths found: ${pathCount}`);

    expect(pathCount, 'No chart paths rendered').toBeGreaterThan(0);

    // Check for gridlines
    const gridlines = await getGridlineYPositions(page);
    console.log(`   Gridlines found: ${gridlines.count || 0}`);

    if (gridlines.error) {
      console.log(`   ⚠️ ${gridlines.error}`);
    }

    expect(gridlines.count, 'Not enough gridlines for test').toBeGreaterThanOrEqual(2);

    console.log('✅ HURDLE 5 PASSED: Chart rendered with data\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 6: Verify Linear Y-Scale (Even Gridline Spacing)
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 6: Gridlines are evenly spaced (linear scale)', async () => {
    console.log('\n🏃 HURDLE 6: Verifying linear Y-scale...');

    const gridlines = await getGridlineYPositions(page);

    if (gridlines.error) {
      throw new Error(`Cannot measure gridlines: ${gridlines.error}`);
    }

    console.log(`   Gridline Y positions: [${gridlines.positions.map(p => p.toFixed(1)).join(', ')}]`);

    const result = checkEvenSpacing(
      gridlines.positions,
      SPACING_TOLERANCE_PX,
      SPACING_TOLERANCE_PCT
    );

    console.log(`   Average spacing: ${result.avgSpacing?.toFixed(1)}px`);
    console.log(`   Individual spacings: [${result.spacings?.map(s => s.toFixed(1)).join(', ')}]`);
    console.log(`   Max deviation: ${result.maxDeviation?.toFixed(1)}px (${(result.maxDeviationPct * 100)?.toFixed(1)}%)`);
    console.log(`   Tolerance: ${SPACING_TOLERANCE_PX}px or ${SPACING_TOLERANCE_PCT * 100}%`);
    console.log(`   Result: ${result.reason}`);

    if (!result.isLinear) {
      // Log detailed deviation info for debugging
      console.log('\n   Deviation details:');
      result.deviations?.forEach((d, i) => {
        const status = d.withinTolerance ? '✓' : '✗';
        console.log(`     ${status} Gap ${i}: ${d.spacing.toFixed(1)}px (deviation: ${d.deviation.toFixed(1)}px / ${(d.deviationPct * 100).toFixed(1)}%)`);
      });
    }

    expect(result.isLinear, result.reason).toBe(true);

    console.log('✅ HURDLE 6 PASSED: Y-scale is linear (gridlines evenly spaced)\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 7: Verify Still Linear After More Data
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 7: Linear scale persists with more data', async () => {
    console.log('\n🏃 HURDLE 7: Waiting for more data, re-checking linearity...');

    // Wait for more data points
    console.log('   Waiting 10s for additional data...');
    await page.waitForTimeout(10000);

    const gridlines = await getGridlineYPositions(page);
    const result = checkEvenSpacing(
      gridlines.positions,
      SPACING_TOLERANCE_PX,
      SPACING_TOLERANCE_PCT
    );

    console.log(`   Gridline positions: [${gridlines.positions.map(p => p.toFixed(1)).join(', ')}]`);
    console.log(`   Max deviation: ${result.maxDeviation?.toFixed(1)}px (${(result.maxDeviationPct * 100)?.toFixed(1)}%)`);
    console.log(`   Result: ${result.reason}`);

    expect(result.isLinear, result.reason).toBe(true);

    console.log('✅ HURDLE 7 PASSED: Linear scale persists\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  test.afterAll(async () => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🎉 ALL HURDLES PASSED - Single-user linear Y-scale working!');
    console.log('═══════════════════════════════════════════════════════════════\n');
  });
});
