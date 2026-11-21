import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RemoteButtonService } from '../application/RemoteButtonService.mjs';
import { YamlRemoteButtonMappingRepository } from '../adapters/persistence/YamlRemoteButtonMappingRepository.mjs';
import { createFitnessRemoteButtonsRouter } from './fitnessRemoteButtons.mjs';

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'remote-buttons-'));
  const logs = [];
  const service = new RemoteButtonService({
    repository: new YamlRemoteButtonMappingRepository({ configService: { getHouseholdPath: () => dir } }),
    clock: { now: () => Date.UTC(2026, 10, 20, 12) },
    logger: { info: (e, d) => logs.push([e, d]) },
  });
  const app = express();
  app.use(express.json());
  app.use('/rb', createFitnessRemoteButtonsRouter({ service, householdId: 'h' }));
  return { dir, app, logs };
}

describe('remote buttons API', () => {
  it('starts empty, saves one remote by address, and reads it back', async () => {
    const { dir, app, logs } = setup();
    try {
      expect((await request(app).get('/rb').expect(200)).body).toEqual({ remotes: {} });
      const put = await request(app).put('/rb/aa:bb:cc:00:00:01')
        .send({ buttons: { MediaPlayPause: 'up', MediaTrackNext: 'next' }, label: 'Right remote', updatedBy: 'admin1' }).expect(200);
      expect(put.body.remotes['AA:BB:CC:00:00:01']).toEqual({
        buttons: { MediaPlayPause: 'up', MediaTrackNext: 'next' }, positions: {}, label: 'Right remote',
        updatedAt: '2026-11-20T12:00:00.000Z', updatedBy: 'admin1',
      });
      const get = await request(app).get('/rb').expect(200);
      expect(get.headers['cache-control']).toBe('no-store');
      expect(get.body.remotes['AA:BB:CC:00:00:01'].buttons.MediaPlayPause).toBe('up');
      expect(readFileSync(path.join(dir, 'remote-buttons.yml'), 'utf8')).toContain('fitness.remote-buttons/v1');
      expect(logs[0][0]).toBe('fitness.remote-buttons.saved');
      expect(logs[0][1]).toMatchObject({ address: 'AA:BB:CC:00:00:01', buttons: 2, changed: 'key:MediaPlayPause,key:MediaTrackNext' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps other remotes when one is saved; concurrent saves both land', async () => {
    const { dir, app } = setup();
    try {
      await Promise.all([
        request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ buttons: { ButtonA: 'select' } }),
        request(app).put('/rb/AA:AA:AA:AA:AA:02').send({ buttons: { ButtonB: 'back' } }),
      ]);
      const { body } = await request(app).get('/rb');
      expect(Object.keys(body.remotes).sort()).toEqual(['AA:AA:AA:AA:AA:01', 'AA:AA:AA:AA:AA:02']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a remote mounted by position saves positions; a later positions save keeps its buttons', async () => {
    const { dir, app } = setup();
    try {
      await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ buttons: { ButtonA: 'select' } }).expect(200);
      const { body } = await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ positions: { up: 'volume-up', center: 'play-pause' } }).expect(200);
      expect(body.remotes['AA:AA:AA:AA:AA:01']).toMatchObject({ buttons: { ButtonA: 'select' }, positions: { up: 'volume-up', center: 'play-pause' } });
      await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ positions: { diagonal: 'up' } }).expect(400);
      await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({}).expect(400);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a bad address, an unknown action, or buttons that are not an object', async () => {
    const { dir, app } = setup();
    try {
      await request(app).put('/rb/not-an-address').send({ buttons: {} }).expect(400);
      await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ buttons: { ButtonA: 'launch-missiles' } }).expect(400);
      await request(app).put('/rb/AA:AA:AA:AA:AA:01').send({ buttons: ['up'] }).expect(400);
      expect((await request(app).get('/rb')).body).toEqual({ remotes: {} });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
