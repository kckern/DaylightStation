import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createAdminArtRouter } from '../../../backend/src/4_api/v1/routers/admin/art.mjs';
import { AdminArtService } from '#apps/admin/AdminArtService.mjs';
import { FilesystemArtAdminRepository } from '#adapters/persistence/files/FilesystemArtAdminRepository.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, mediaPath, householdDir, app;

async function writeWork(folder, metaLines) {
  const dir = path.join(mediaPath, 'img', 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

function createApp() {
  const repository = new FilesystemArtAdminRepository({ mediaPath, householdDir, logger: noop });
  const artService = new AdminArtService({ repository, logger: noop });
  const mounted = express();
  mounted.use(express.json());
  mounted.use('/art', createAdminArtRouter({ artService, logger: noop }));
  return mounted;
}

function writeCollections(collections) {
  const dir = path.join(householdDir, 'art');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), `collections:\n${Object.entries(collections).map(([key, value]) => [
    `  ${key}:`,
    ...Object.entries(value).map(([field, fieldValue]) => `    ${field}: ${fieldValue}`),
  ].join('\n')).join('\n')}\n`);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adminart-'));
  mediaPath = tmp;
  householdDir = path.join(tmp, 'household');
  await writeWork('alpha', "date: '1875'\n");
  await writeWork('beta', "date: '1875'\nhidden: true\n");
  app = createApp();
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('admin art router', () => {
  it('GET /works lists all works incl. hidden', async () => {
    const res = await request(app).get('/art/works');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 60 });
    expect(res.body.works.map((w) => w.id).sort()).toEqual(['alpha', 'beta']);
    expect(res.body.works.find((work) => work.id === 'alpha')).toEqual({
      id: 'alpha',
      image: '/media/img/art/classic/alpha/art.png',
      meta: {
        title: 'alpha', artist: null, date: '1875', origin: null, medium: null,
        department: null, credit: null, category: null, display: null, section: null,
        crop_anchor: null, tags: [], exclude: [], hidden: false, flagged: false,
        crop: null, width: 16, height: 12,
      },
    });
    expect(res.body.works.every((work) => !('path' in work) && !('localPath' in work))).toBe(true);
  });

  it('GET /works?hidden=true filters', async () => {
    const res = await request(app).get('/art/works?hidden=true');
    expect(res.body.works.map((w) => w.id)).toEqual(['beta']);
  });

  it('PATCH /works/:id writes metadata.yaml and reflects on next GET', async () => {
    const patch = await request(app).patch('/art/works/alpha').send({ tags: ['impressionism'], crop_anchor: 'top' });
    expect(patch.status).toBe(200);
    expect(patch.body.meta).toMatchObject({ tags: ['impressionism'], crop_anchor: 'top' });
    const res = await request(app).get('/art/works?tag=impressionism');
    expect(res.body.works.map((w) => w.id)).toEqual(['alpha']);
  });

  it('PATCH rejects an invalid anchor', async () => {
    const res = await request(app).patch('/art/works/alpha').send({ crop_anchor: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid crop_anchor: banana' });
  });

  it('PATCH rejects an invalid crop with 400 (not 500)', async () => {
    const res = await request(app).patch('/art/works/alpha').send({ crop: { top: 80, bottom: 30 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid crop: {"top":80,"bottom":30}' });
  });

  it('PATCH preserves the missing-work 404 contract', async () => {
    const res = await request(app).patch('/art/works/missing').send({ hidden: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Work not found' });
  });

  it('PATCH rejects path traversal', async () => {
    const res = await request(app).patch('/art/works/..%2f..%2fescape').send({ hidden: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid work id' });
  });

  it('PATCH rejects source-based traversal (scope escape)', async () => {
    const res = await request(app).patch('/art/works/alpha').send({ source: '../../../../etc', hidden: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid source' });
  });

  it('GET rejects source-based traversal (scope escape)', async () => {
    const res = await request(app).get('/art/works?source=..%2f..%2f..%2fetc');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid source' });
  });

  // A known collection name matches by RULE or hand-tag — so rule-based members are
  // curatable, not just hand-tagged ones — and hidden members are still listed.
  it('tag filter matches a known collection by rule OR hand-tag (hidden still listed)', async () => {
    await writeWork('gamma', "date: '1500'\ntags:\n  - impressionism\n"); // tagged, out of date range
    await writeWork('delta', "date: '1500'\n");                            // neither rule nor tag
    writeCollections({ impressionism: { dateMin: 1860, dateMax: 1900 } });
    const colApp = createApp();
    const res = await request(colApp).get('/art/works?tag=impressionism');
    // alpha+beta match the 1860-1900 rule (beta hidden, still listed), gamma by tag; delta excluded.
    expect(res.body.works.map((w) => w.id).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('tag filter falls back to a plain hand-tag match for a non-collection tag', async () => {
    await writeWork('tagged', "date: '1500'\ntags:\n  - misc\n");
    writeCollections({ impressionism: { dateMin: 1860, dateMax: 1900 } });
    const colApp = createApp();
    const res = await request(colApp).get('/art/works?tag=misc');
    expect(res.body.works.map((w) => w.id)).toEqual(['tagged']);
  });
});
