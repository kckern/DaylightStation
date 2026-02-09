/**
 * Content Regression Test Matrix
 *
 * Validates that all existing content URLs continue to work.
 * Run this after every phase of the content taxonomy redesign.
 *
 * Includes:
 * - Hardcoded fixtures (stable baseline of known-good URLs)
 * - Dynamic samples (generated from real list configs at runtime)
 */
import { test, expect } from '@playwright/test';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { load } from 'js-yaml';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3111';

// ── Hardcoded API fixtures (stable baseline) ──────────────────
const API_FIXTURES = [
  { name: 'Play API (plex)',         url: `${BASE}/api/v1/play/plex/457385` },
  { name: 'Info API (hymn 166)',     url: `${BASE}/api/v1/info/singalong/hymn/166` },
  { name: 'Info API (hymn 108)',     url: `${BASE}/api/v1/info/singalong/hymn/108` },
  { name: 'LocalContent scripture',  url: `${BASE}/api/v1/local-content/scripture/alma-32` },
  { name: 'LocalContent talk',       url: `${BASE}/api/v1/local-content/talk/ldsgc` },
  { name: 'LocalContent poem',       url: `${BASE}/api/v1/local-content/poem/remedy/01` },
  { name: 'List API (watchlist)',     url: `${BASE}/api/v1/list/watchlist/comefollowme2024` },
  { name: 'List API (menu)',          url: `${BASE}/api/v1/list/menu/fhe` },
];

// ── Hardcoded TV page fixtures ─────────────────────────────────
const TV_FIXTURES = [
  { name: 'Plex video',        url: `${BASE}/tv?play=plex:457385` },
  { name: 'Hymn (legacy)',      url: `${BASE}/tv?hymn=166` },
  { name: 'Hymn (canonical)',   url: `${BASE}/tv?play=singalong:hymn/108` },
  { name: 'Primary song',      url: `${BASE}/tv?primary=42` },
  { name: 'Scripture',          url: `${BASE}/tv?scripture=alma-32` },
  { name: 'Talk',               url: `${BASE}/tv?talk=ldsgc` },
  { name: 'Poem',               url: `${BASE}/tv?poem=remedy/01` },
  { name: 'Watchlist browse',   url: `${BASE}/tv?list=watchlist:comefollowme2024` },
  { name: 'Menu browse',        url: `${BASE}/tv?list=menu:fhe` },
  { name: 'Media file',         url: `${BASE}/tv?play=media:sfx/intro` },
];

// ── Dynamic sample builder ─────────────────────────────────────
function loadDynamicSamples() {
  const DATA_PATH = getDataPath();
  if (!DATA_PATH) return { menus: [], watchlists: [], programs: [] };

  const LISTS_PATH = `${DATA_PATH}/household/config/lists`;
  if (!existsSync(LISTS_PATH)) return { menus: [], watchlists: [], programs: [] };

  const samples = { menus: [], watchlists: [], programs: [] };
  const MAX_PER_FILE = 2;

  const readYamlDir = (subdir) => {
    const dir = `${LISTS_PATH}/${subdir}`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => {
        try { return { file: f, data: load(readFileSync(`${dir}/${f}`, 'utf8')) }; }
        catch { return null; }
      })
      .filter(Boolean);
  };

  for (const { file, data } of readYamlDir('menus')) {
    const items = (data?.items || (Array.isArray(data) ? data : [])).filter(i => i.input);
    const picked = items.sort(() => Math.random() - 0.5).slice(0, MAX_PER_FILE);
    samples.menus.push(...picked.map(i => ({
      file, label: i.label, input: i.input?.trim(), action: i.action
    })));
  }

  for (const { file, data } of readYamlDir('watchlists')) {
    if (!Array.isArray(data)) continue;
    const picked = data.filter(i => i.src && i.media_key)
      .sort(() => Math.random() - 0.5).slice(0, MAX_PER_FILE);
    samples.watchlists.push(...picked.map(i => ({
      file, title: i.title, src: i.src, media_key: String(i.media_key)
    })));
  }

  for (const { file, data } of readYamlDir('programs')) {
    if (!Array.isArray(data)) continue;
    const picked = data.filter(i => i.input)
      .sort(() => Math.random() - 0.5).slice(0, MAX_PER_FILE);
    samples.programs.push(...picked.map(i => ({
      file, label: i.label, input: i.input?.trim(), action: i.action
    })));
  }

  return samples;
}

function buildTestUrl(input, action) {
  const normalized = input.replace(/^(\w+):\s+/, '$1:');
  const act = (action || 'Play').toLowerCase();
  switch (act) {
    case 'list': return `${BASE}/tv?list=${normalized}`;
    case 'open': return null;
    case 'display': return `${BASE}/tv?display=${normalized}`;
    case 'queue': return `${BASE}/tv?queue=${normalized}`;
    default: return `${BASE}/tv?play=${normalized}`;
  }
}

// ── Test Suite ─────────────────────────────────────────────────
test.describe('Content Regression Matrix', () => {
  test.setTimeout(60000);

  // ── API Health Checks ──
  test.describe('API endpoints return 200', () => {
    for (const fixture of API_FIXTURES) {
      test(`API: ${fixture.name}`, async ({ request }) => {
        const res = await request.get(fixture.url);
        expect(res.status(), `${fixture.name} should return 200`).toBe(200);
        const body = await res.json();
        expect(body).toBeTruthy();
      });
    }
  });

  // ── TV Page Loads ──
  test.describe('TV page loads without API errors', () => {
    for (const fixture of TV_FIXTURES) {
      test(`TV: ${fixture.name}`, async ({ page }) => {
        const networkErrors = [];

        page.on('response', res => {
          // Only count 500+ as real errors; 404 is normal for frontend content probing
          if (res.url().includes('/api/') && res.status() >= 500) {
            networkErrors.push(`${res.status()} ${res.url()}`);
          }
        });

        await page.goto(fixture.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(3000);

        expect(networkErrors.length,
          `No server errors for ${fixture.name}: ${networkErrors.join(', ')}`
        ).toBe(0);
      });
    }
  });

  // ── Dynamic Samples ──
  test.describe('Dynamic samples from real config', () => {
    const samples = loadDynamicSamples();

    for (const item of samples.menus) {
      const testUrl = buildTestUrl(item.input, item.action);
      if (!testUrl) continue;

      test(`Menu: ${item.label} (${item.file})`, async ({ page }) => {
        const networkErrors = [];
        page.on('response', res => {
          if (res.url().includes('/api/') && res.status() >= 500) {
            networkErrors.push(`${res.status()} ${res.url()}`);
          }
        });

        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        expect(networkErrors.length,
          `No API errors for menu ${item.label}: ${networkErrors.join(', ')}`
        ).toBe(0);
      });
    }

    for (const item of samples.watchlists) {
      test(`Watchlist: ${item.title || item.media_key} (${item.file})`, async ({ page }) => {
        const contentId = `${item.src}:${item.media_key}`;
        const url = `${BASE}/tv?play=${contentId}`;
        const networkErrors = [];
        page.on('response', res => {
          if (res.url().includes('/api/') && res.status() >= 500) {
            networkErrors.push(`${res.status()} ${res.url()}`);
          }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        expect(networkErrors.length,
          `No API errors for watchlist ${item.title}: ${networkErrors.join(', ')}`
        ).toBe(0);
      });
    }

    for (const item of samples.programs) {
      const testUrl = buildTestUrl(item.input, item.action);
      if (!testUrl) continue;

      test(`Program: ${item.label} (${item.file})`, async ({ page }) => {
        const networkErrors = [];
        page.on('response', res => {
          if (res.url().includes('/api/') && res.status() >= 500) {
            networkErrors.push(`${res.status()} ${res.url()}`);
          }
        });

        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        expect(networkErrors.length,
          `No API errors for program ${item.label}: ${networkErrors.join(', ')}`
        ).toBe(0);
      });
    }
  });
});
