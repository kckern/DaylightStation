import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createContentFilterRouter } from "../../../../__app_modules/media/media/server/api/contentFilter.mjs";
import { GetContentFilter } from "../../../../__app_modules/media/media/server/application/content-filter/usecases/GetContentFilter.mjs";
import { ContentFilterScenes } from "../../../../__app_modules/media/media/server/application/content-filter/usecases/ContentFilterScenes.mjs";
import { FilesystemContentFilterRepository } from "../../../../__app_modules/media/media/server/adapters/persistence/FilesystemContentFilterRepository.mjs";

const PROFILE = {
  name: 'Family',
  categories: { language: { effect: 'mute' }, sex_any: { effect: 'full-blur' } },
  treatments: { 'skip-card': { holdSec: 4.5 } },
  theme: { font: 'Roboto Condensed' },
  scenes: { sex_any: { blackout: { picture: 2 }, skip: { situation: 3 } } },
  requiresCertification: 'parent',
};
const S = { language: 'bleep', violence: 'blackout', nudity: 'off', sexual: 'blur' };

describe('content-filter settings routes', () => {
  let tmpRoot; let householdDir; let mediaDir; let app;
  const quiet = { info() {}, warn() {}, child() { return quiet; } };
  const read = (rel) => yaml.load(readFileSync(path.join(householdDir, rel), 'utf8'));

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'content-filter-settings-'));
    householdDir = path.join(tmpRoot, 'household');
    mediaDir = path.join(tmpRoot, 'media');
    for (const d of ['profiles', 'overrides']) mkdirSync(path.join(householdDir, 'content-filter', d), { recursive: true });
    for (const d of ['edl', 'refined']) mkdirSync(path.join(mediaDir, 'content-filter', d), { recursive: true });
    writeFileSync(path.join(mediaDir, 'content-filter/edl/77.edl.yml'), yaml.dump({ sourceRef: { workId: 5, tagSetId: 6 }, cues: [] }));
    writeFileSync(path.join(mediaDir, 'content-filter/refined/5-6.edl.yml'), yaml.dump({ title: 'Film', cues: [], scenes: [] }));
    writeFileSync(path.join(householdDir, 'content-filter/profiles/family.yml'), yaml.dump(PROFILE));
    writeFileSync(path.join(householdDir, 'content-filter/overrides/77.yml'), yaml.dump({ sync: { scale: 1, offsetSec: 10, part: '9' } }));
    const repo = new FilesystemContentFilterRepository({ householdDir, mediaDir, logger: quiet });
    app = express();
    app.use(express.json());
    app.use('/cf', createContentFilterRouter({
      getContentFilter: new GetContentFilter({ contentFilterRepository: repo }),
      contentFilterScenes: new ContentFilterScenes({ contentFilterRepository: repo, logger: quiet }),
      logger: quiet,
    }));
  });
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  test('PUT /:rk/settings writes override.profilePatch and GET serves the merged profile', async () => {
    const res = await request(app).put('/cf/77/settings').send({ settings: S });
    expect(res.status).toBe(200);
    const ov = read('content-filter/overrides/77.yml');
    expect(ov.sync.part).toBe('9');
    expect(ov.profilePatch.categories.language).toEqual({ effect: 'bleep' });
    const got = await request(app).get('/cf/77');
    expect(got.body.profile.categories.language).toEqual({ effect: 'bleep' });
    expect(got.body.profile.theme).toEqual(PROFILE.theme);
    expect(got.body.profile.scenes.violence_blood_gore).toEqual({ blackout: { picture: 2 } });
  });

  test('two simultaneous settings PUTs both persist (serialized)', async () => {
    const a = request(app).put('/cf/77/settings').send({ settings: S });
    const b = request(app).put('/cf/77/scenes/zzz').send({ effect: 'off' }); // unrelated write path, must not clobber
    const c = request(app).put('/cf/77/settings').send({ settings: { ...S, language: 'mute' } });
    const [ra, , rc] = await Promise.all([a, b, c]);
    expect([ra.status, rc.status]).toEqual([200, 200]);
    const ov = read('content-filter/overrides/77.yml');
    expect(ov.sync.part).toBe('9');
    expect(ov.profilePatch.categories.language).toEqual({ effect: 'mute' });
  });

  test('DELETE /:rk/settings removes the patch only', async () => {
    await request(app).put('/cf/77/settings').send({ settings: S });
    const res = await request(app).delete('/cf/77/settings');
    expect(res.status).toBe(200);
    const ov = read('content-filter/overrides/77.yml');
    expect(ov.profilePatch).toBeUndefined();
    expect(ov.sync.part).toBe('9');
  });

  test('PUT /profiles/:name/settings rewrites owned keys, keeps the rest', async () => {
    const res = await request(app).put('/cf/profiles/family/settings').send({ settings: S });
    expect(res.status).toBe(200);
    const p = read('content-filter/profiles/family.yml');
    expect(p.name).toBe('Family');
    expect(p.treatments).toEqual(PROFILE.treatments);
    expect(p.theme).toEqual(PROFILE.theme);
    expect(p.requiresCertification).toBe('parent');
    expect(p.categories.language).toEqual({ effect: 'bleep' });
    expect(p.scenes).toEqual({ violence_blood_gore: { blackout: { picture: 2 } } });
  });

  test('rejects bad settings, odd profile names and a missing profile', async () => {
    expect((await request(app).put('/cf/77/settings').send({})).status).toBe(400);
    expect((await request(app).put('/cf/profiles/nope/settings').send({ settings: S })).status).toBe(404);
    expect(existsSync(path.join(householdDir, 'content-filter/profiles/nope.yml'))).toBe(false);
  });
});
