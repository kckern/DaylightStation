import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createContentFilterRouter } from '#backend/src/4_api/v1/routers/contentFilter.mjs';

/**
 * Proves the content-filter router resolves TWO roots (task 9 of the
 * data/media reorg): curated policy (profiles/, overrides/) under
 * householdDir/content-filter, and machine-fetched EDLs under
 * mediaDir/content-filter/edl/. A regression that points both at the same
 * root would either 404 the EDL or silently drop the profile/override.
 */
describe('content-filter router — two-root resolution', () => {
  let tmpRoot;
  let householdDir;
  let mediaDir;
  let app;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'content-filter-test-'));
    householdDir = path.join(tmpRoot, 'household');
    mediaDir = path.join(tmpRoot, 'media');

    // Curated policy lives under householdDir/content-filter/{profiles,overrides}
    mkdirSync(path.join(householdDir, 'content-filter', 'profiles'), { recursive: true });
    mkdirSync(path.join(householdDir, 'content-filter', 'overrides'), { recursive: true });
    // Machine-fetched EDL lives under mediaDir/content-filter/edl
    mkdirSync(path.join(mediaDir, 'content-filter', 'edl'), { recursive: true });

    writeFileSync(
      path.join(mediaDir, 'content-filter', 'edl', '349222.edl.yml'),
      yaml.dump({ cues: [{ id: 'c1', in: 1, out: 2, effect: 'mute' }] })
    );
    writeFileSync(
      path.join(householdDir, 'content-filter', 'profiles', 'family.yml'),
      yaml.dump({ name: 'family' })
    );
    writeFileSync(
      path.join(householdDir, 'content-filter', 'overrides', '349222.yml'),
      yaml.dump({ source: 'manual', addCues: [{ id: 'manual1' }] })
    );

    const router = createContentFilterRouter({
      householdDir,
      mediaDir,
      logger: { info: () => {}, warn: () => {} },
    });
    app = express();
    app.use('/api/v1/content-filter', router);
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('merges EDL from mediaDir with profile+override from householdDir', async () => {
    const res = await request(app).get('/api/v1/content-filter/349222?profile=family');
    expect(res.status).toBe(200);
    expect(res.body.edl.cues).toHaveLength(1);
    expect(res.body.profile.name).toBe('family');
    expect(res.body.override.addCues[0].id).toBe('manual1');
  });

  test('404s when the EDL is missing from mediaDir even if householdDir has data', async () => {
    const res = await request(app).get('/api/v1/content-filter/999999?profile=family');
    expect(res.status).toBe(404);
  });
});
