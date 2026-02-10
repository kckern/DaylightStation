/**
 * FreshVideo Manual Run - Live Test
 *
 * Exercises the full FreshVideoJobHandler → FreshVideoService → YtDlpAdapter
 * chain against real data, without requiring a running server.
 *
 * Resolves paths from .env (DAYLIGHT_BASE_PATH) just like the app does.
 *
 * Usage:
 *   npx jest tests/live/adapter/freshvideo-manual-run.test.mjs --no-cache
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createFreshVideoJobHandler } from '#apps/media/FreshVideoJobHandler.mjs';
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';

function getBasePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;

  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/DAYLIGHT_BASE_PATH=(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

const TIMEOUT_MS = 10 * 60 * 1000; // 10 min — downloads can be slow

describe('FreshVideo manual run', () => {
  let handler;
  let mediaPath;
  let householdDir;

  beforeAll(() => {
    const basePath = getBasePath();
    if (!basePath) throw new Error('DAYLIGHT_BASE_PATH not set');

    // media lives at {basePath}/media, data at {basePath}/data
    mediaPath = path.join(basePath, 'media', 'video', 'news');
    householdDir = path.join(basePath, 'data', 'household');
    const configPath = path.join(householdDir, 'state', 'youtube.yml');

    expect(fs.existsSync(mediaPath)).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    const loadFile = (relativePath) => {
      const fullPath = path.join(householdDir, relativePath + '.yml');
      const raw = fs.readFileSync(fullPath, 'utf8');
      return yaml.load(raw);
    };

    const videoSourceGateway = new YtDlpAdapter({ logger: console });

    handler = createFreshVideoJobHandler({
      videoSourceGateway,
      loadFile,
      mediaPath,
      logger: console,
    });
  });

  it('should execute the full freshvideo download job', async () => {
    const result = await handler(console, 'manual-test-run');

    // If skipped (lock held or no config), that's a valid outcome — report it
    if (result.skipped) {
      console.log(`Job skipped: ${result.reason}`);
      expect(result.reason).toBeDefined();
      return;
    }

    // Otherwise we expect a real result
    expect(result.providers).toBeDefined();
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers.length).toBeGreaterThan(0);

    console.log('Providers processed:', result.providers);
    console.log('Files retained:', result.files.length);
    console.log('Old files deleted:', result.deleted.length);

    if (result.results) {
      for (const r of result.results) {
        const status = r.success ? (r.skipped ? 'skipped (already exists)' : 'downloaded') : `FAILED: ${r.error}`;
        console.log(`  ${r.provider}: ${status}`);
      }
    }
  }, TIMEOUT_MS);
});
