import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createContentFilterRouter } from "../../../../__app_modules/media/media/server/api/contentFilter.mjs";
import { GetContentFilter } from "../../../../__app_modules/media/media/server/application/content-filter/usecases/GetContentFilter.mjs";
import { ContentFilterScenes } from "../../../../__app_modules/media/media/server/application/content-filter/usecases/ContentFilterScenes.mjs";
import { FilesystemContentFilterRepository } from "../../../../__app_modules/media/media/server/adapters/persistence/FilesystemContentFilterRepository.mjs";

/** Scene review routes over the real filesystem repository: list, draft cards, rule. */
describe('content-filter scenes routes', () => {
  let tmpRoot; let householdDir; let mediaDir; let app;
  const quiet = { info() {}, warn() {}, child() { return quiet; } };

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'content-filter-scenes-'));
    householdDir = path.join(tmpRoot, 'household');
    mediaDir = path.join(tmpRoot, 'media');
    for (const d of ['profiles', 'overrides']) mkdirSync(path.join(householdDir, 'content-filter', d), { recursive: true });
    for (const d of ['edl', 'refined', 'refine/77']) mkdirSync(path.join(mediaDir, 'content-filter', d), { recursive: true });
    writeFileSync(path.join(mediaDir, 'content-filter/edl/77.edl.yml'), yaml.dump({ sourceRef: { workId: 5, tagSetId: 6 }, cues: [] }));
    writeFileSync(path.join(mediaDir, 'content-filter/refined/5-6.edl.yml'), yaml.dump({
      title: 'Film', timebase: { clock: 'vidangel' }, sceneCalibration: { situation: 'trusted', picture: 'trusted' },
      cues: [{ id: 'va1', label: 'A man is shot.' }],
      scenes: [{ id: 'sc-va1', in: 100, out: 150, cues: ['va1'], groups: ['violence_blood_gore'], level: { violence_blood_gore: { situation: 2, picture: 2 } } }],
    }));
    writeFileSync(path.join(mediaDir, 'content-filter/refine/77/words-9.json'), JSON.stringify({ segments: [{ s: 165, e: 170, text: 'We made it.' }] }));
    writeFileSync(path.join(householdDir, 'content-filter/profiles/family.yml'), yaml.dump({ scenes: { violence_blood_gore: { blackout: { picture: 2 } } } }));
    writeFileSync(path.join(householdDir, 'content-filter/overrides/77.yml'), yaml.dump({ sync: { scale: 1, offsetSec: 10, part: '9' } }));

    const repo = new FilesystemContentFilterRepository({ householdDir, mediaDir, logger: quiet });
    app = express();
    app.use(express.json());
    app.use('/cf', createContentFilterRouter({
      getContentFilter: new GetContentFilter({ contentFilterRepository: repo }),
      contentFilterScenes: new ContentFilterScenes({ contentFilterRepository: repo, aiGateway: { chat: async () => 'They get away.' }, logger: quiet }),
      logger: quiet,
    }));
  });
  afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

  test('lists titles with a refined filter', async () => {
    const res = await request(app).get('/cf/');
    expect(res.body.titles).toEqual([{ ratingKey: '77', title: 'Film', year: null, certification: 'none', scenes: 1, hiding: 1, cardsApproved: 0 }]);
  });

  test('lists scenes with the profile effect', async () => {
    const res = await request(app).get('/cf/77/scenes');
    expect(res.status).toBe(200);
    expect(res.body.scenes[0]).toMatchObject({ id: 'sc-va1', effect: 'blackout', tags: ['A man is shot.'], localIn: 110 });
  });

  test('drafts a card into the refined EDL, then approves it into the override', async () => {
    expect((await request(app).post('/cf/77/scenes/cards').send({})).body).toEqual({ drafted: 1, scenes: 1 });
    const refined = yaml.load(readFileSync(path.join(mediaDir, 'content-filter/refined/5-6.edl.yml'), 'utf8'));
    expect(refined.scenes[0].card.text).toBe('They get away.');

    const put = await request(app).put('/cf/77/scenes/sc-va1').send({ card: { approve: true }, effect: 'skip', by: 'parent' });
    expect(put.status).toBe(200);
    const override = yaml.load(readFileSync(path.join(householdDir, 'content-filter/overrides/77.yml'), 'utf8'));
    expect(override.sceneOverrides['sc-va1']).toMatchObject({ effect: 'skip', card: { text: 'They get away.', approvedBy: 'parent' } });
    expect(override.sync.part).toBe('9');
  });

  test('rejects a cue or scene id that is not clean (e.g. a measured va123#0) with 400', async () => {
    expect((await request(app).put('/cf/77/cues/va123%230').send({ effect: 'mute' })).status).toBe(400);
    expect((await request(app).put('/cf/77/scenes/sc-va1%230').send({ effect: 'off' })).status).toBe(400);
    expect((await request(app).post('/cf/77/scenes/sc-va1%230/card').send({})).status).toBe(400);
  });

  test('rejects a bad effect and an unknown scene', async () => {
    expect((await request(app).put('/cf/77/scenes/sc-va1').send({ effect: 'explode' })).status).toBe(400);
    expect((await request(app).put('/cf/77/scenes/sc-nope').send({ effect: 'off' })).status).toBe(404);
  });
  test('redrafts one scene card, 404 for an unknown scene', async () => {
    const ok = await request(app).post('/cf/77/scenes/sc-va1/card').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.card.text).toBe('They get away.');
    expect((await request(app).post('/cf/77/scenes/sc-nope/card').send({})).status).toBe(404);
  });

  test('rules a cue: 200, 400 on a bad effect, 404 unknown', async () => {
    const ok = await request(app).put('/cf/77/cues/va1').send({ effect: 'bleep' });
    expect(ok.status).toBe(200);
    expect(ok.body.ruling).toEqual({ effect: 'bleep' });
    const override = yaml.load(readFileSync(path.join(householdDir, 'content-filter/overrides/77.yml'), 'utf8'));
    expect(override.cueOverrides.va1).toEqual({ effect: 'bleep' });
    expect((await request(app).put('/cf/77/cues/va1').send({ effect: 'explode' })).status).toBe(400);
    expect((await request(app).put('/cf/77/cues/zzz').send({ effect: 'mute' })).status).toBe(404);
  });
});
