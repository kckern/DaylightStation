/**
 * POST /api/v1/media/household/playlists — the phone's Save as playlist.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHouseholdPlaylistsRouter } from './householdPlaylists.mjs';
import { ListManagementService } from '../../../../../__capabilities/content-catalog/server/application/services/ListManagementService.mjs';

function memoryStore() {
  const lists = new Map();
  return {
    lists,
    createList(type, name) {
      const key = `${type}/${name}`;
      if (lists.has(key)) return false;
      lists.set(key, { title: name, metadata: {}, sections: [{ items: [] }] });
      return true;
    },
    getList(type, name) { return lists.get(`${type}/${name}`) ?? null; },
    saveList(type, name, _hid, list) { lists.set(`${type}/${name}`, list); },
  };
}

function makeApp() {
  const store = memoryStore();
  const service = new ListManagementService({ listStore: store, logger: { info: vi.fn() } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/media', createHouseholdPlaylistsRouter({ listManagementService: service, logger: { info: vi.fn() } }));
  return { app, store };
}

describe('POST /media/household/playlists', () => {
  it('creates a list with the items in queue order, kept in that order', async () => {
    const { app, store } = makeApp();
    const res = await request(app).post('/api/v1/media/household/playlists').send({
      title: 'Queue 2026-11-26',
      items: [{ id: 'plex:3', title: 'Third' }, { id: 'plex:1', title: 'First' }, { id: 'plex:2' }],
    }).expect(201);
    expect(res.body).toMatchObject({ ok: true, id: 'menu:queue-2026-11-26', title: 'Queue 2026-11-26', count: 3 });
    const list = store.lists.get('menus/queue-2026-11-26');
    expect(list.sections[0].items.map((i) => i.play?.contentId ?? i.input)).toEqual(['plex:3', 'plex:1', 'plex:2']);
    expect(list.sections[0].items[2].label).toBe('plex:2');
    expect(list.title).toBe('Queue 2026-11-26');
    expect(list.metadata.fixed_order).toBe(true);
  });

  it('numbers a name already taken', async () => {
    const { app } = makeApp();
    const body = { title: 'Road trip', items: [{ id: 'plex:1' }] };
    await request(app).post('/api/v1/media/household/playlists').send(body).expect(201);
    const second = await request(app).post('/api/v1/media/household/playlists').send(body).expect(201);
    expect(second.body.id).toBe('menu:road-trip-2');
  });

  it('refuses a missing title, no items, or an item that is not a content id', async () => {
    const { app } = makeApp();
    await request(app).post('/api/v1/media/household/playlists').send({ items: [{ id: 'plex:1' }] }).expect(400);
    await request(app).post('/api/v1/media/household/playlists').send({ title: 'x', items: [] }).expect(400);
    await request(app).post('/api/v1/media/household/playlists').send({ title: 'x', items: [{ id: 'not an id' }] }).expect(400);
  });
});
