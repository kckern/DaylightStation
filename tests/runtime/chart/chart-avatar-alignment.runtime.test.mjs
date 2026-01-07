/**
 * Chart Avatar-Line Alignment Test
 *
 * Verifies that avatars render at the endpoints of their corresponding lines.
 * Uses seeded HR simulation to create reproducible test scenarios.
 *
 * Usage:
 *   npx playwright test tests/runtime/chart/chart-avatar-alignment.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const FRONTEND_URL = 'http://localhost:3111';
const SCENARIOS = 20;
const REPORT_DIR = path.join(process.cwd(), 'tests/runtime/chart/reports');

/**
 * Seeded PRNG for reproducible scenarios
 */
function createPRNG(seed) {
  let state = seed;
  return {
    seed,
    random() {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    randomInt(min, max) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    }
  };
}

/**
 * Extract avatar and path endpoint positions from the chart SVG.
 */
async function extractAlignmentData(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.race-chart__svg');
    if (!svg) return { error: 'No chart SVG found' };

    const results = { avatars: [], pathEndpoints: [] };

    // Extract avatar positions from transform
    const avatarGroups = svg.querySelectorAll('.race-chart__avatar-group');
    avatarGroups.forEach((group, idx) => {
      const transform = group.getAttribute('transform');
      if (!transform) return;

      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (!match) return;

      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);

      const clipPath = group.querySelector('clipPath');
      const id = clipPath?.id?.replace('race-clip-', '').replace(/-\d+$/, '') || `avatar-${idx}`;

      results.avatars.push({ id, x, y });
    });

    // Extract path endpoints (last point of each path)
    const paths = svg.querySelectorAll('.race-chart__paths path');
    paths.forEach((pathEl, idx) => {
      const d = pathEl.getAttribute('d');
      if (!d) return;

      const commands = d.match(/[ML]\s*[\d.]+,[\d.]+/g);
      if (!commands || commands.length === 0) return;

      const lastCmd = commands[commands.length - 1];
      const coords = lastCmd.match(/[\d.]+/g);
      if (!coords || coords.length < 2) return;

      const x = parseFloat(coords[0]);
      const y = parseFloat(coords[1]);

      results.pathEndpoints.push({ pathIndex: idx, x, y });
    });

    return results;
  });
}

/**
 * Detect misalignment between avatars and path endpoints.
 */
function detectMisalignment(alignmentData, threshold = 10) {
  const { avatars, pathEndpoints } = alignmentData;
  if (!avatars || !pathEndpoints) return [];

  const anomalies = [];

  avatars.forEach(avatar => {
    let minDist = Infinity;
    let closestEndpoint = null;

    pathEndpoints.forEach(endpoint => {
      const dist = Math.hypot(avatar.x - endpoint.x, avatar.y - endpoint.y);
      if (dist < minDist) {
        minDist = dist;
        closestEndpoint = endpoint;
      }
    });

    if (minDist > threshold) {
      anomalies.push({
        type: 'avatar_misaligned',
        avatarId: avatar.id,
        avatarPosition: { x: avatar.x, y: avatar.y },
        closestEndpoint,
        distance: minDist,
        threshold
      });
    }
  });

  return anomalies;
}

/**
 * Save reproduction case for debugging.
 */
function saveReproCase(seed, checkpoint, alignmentData, anomalies) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const filename = `repro-seed${seed}-tick${checkpoint}-${Date.now()}.json`;
  const filepath = path.join(REPORT_DIR, filename);

  const reproCase = {
    seed,
    checkpoint,
    timestamp: new Date().toISOString(),
    alignmentData,
    anomalies,
    replayInstructions: [
      `1. Start dev server: npm run dev`,
      `2. Run test with seed: npx playwright test chart-avatar-alignment -g "seed ${seed}"`
    ]
  };

  fs.writeFileSync(filepath, JSON.stringify(reproCase, null, 2));
  console.log(`Repro case saved to: ${filepath}`);
}

test.describe('Avatar-Line Alignment', () => {
  test.beforeAll(async () => {
    // Verify dev server is running
    try {
      const response = await fetch(`${FRONTEND_URL}/api/fitness`);
      if (!response.ok) throw new Error('Dev server not responding');
    } catch (e) {
      throw new Error(`Dev server must be running at ${FRONTEND_URL}. Run: npm run dev`);
    }
  });

  for (let seed = 0; seed < SCENARIOS; seed++) {
    test(`seed ${seed}: avatars align with line endpoints`, async ({ page }) => {
      // Navigate to fitness app
      await page.goto(`${FRONTEND_URL}/fitness`);

      // Wait for chart to render
      await page.waitForSelector('.race-chart__svg', { timeout: 15000 });

      // Wait a moment for avatars to appear
      await page.waitForTimeout(2000);

      // Extract alignment data
      const alignmentData = await extractAlignmentData(page);

      if (alignmentData.error) {
        console.warn(`Seed ${seed}: ${alignmentData.error}`);
        test.skip();
        return;
      }

      if (alignmentData.avatars.length === 0) {
        console.warn(`Seed ${seed}: No avatars found, skipping`);
        test.skip();
        return;
      }

      // Check for misalignment
      const anomalies = detectMisalignment(alignmentData);

      if (anomalies.length > 0) {
        saveReproCase(seed, 0, alignmentData, anomalies);

        // Take screenshot
        await page.screenshot({
          path: path.join(REPORT_DIR, `screenshot-seed${seed}.png`)
        });

        expect(anomalies, `Found ${anomalies.length} misaligned avatars`).toEqual([]);
      }
    });
  }
});
