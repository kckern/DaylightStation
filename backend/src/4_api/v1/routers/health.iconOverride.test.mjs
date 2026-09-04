import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A manifest store stub offering exactly two slugs. */
function manifest(slugs = ['fried-eggs', 'avocado-toast']) {
  return {
    list: () => [...slugs].sort(),
    has: (slug) => slugs.includes(slug),
    search: (q, limit = 60) => [...slugs].sort().filter((s) => s.includes(q || '')).slice(0, limit),
    resolve: () => null,
  };
}

function makeApp({ withManifest = true, catalog = {}, operations = {} } = {}) {
  const calls = { setIconByName: [], setIcon: [], update: [] };
  const catalogService = {
    setIcon: async (id, userId, icon) => {
      calls.setIcon.push({ id, userId, icon });
      if (catalog.missing) throw new Error(`Catalog entry not found: ${id}`);
      return { id, name: 'Eggs', normalizedName: 'eggs', nutrients: {}, useCount: 1, icon };
    },
    setIconByName: async (name, userId, icon) => {
      calls.setIconByName.push({ name, userId, icon });
      if (catalog.missing) throw new Error(`Catalog entry not found by name: ${name}`);
      return { id: 'e1', name, normalizedName: name.toLowerCase(), nutrients: {}, useCount: 1, icon };
    },
  };
  const healthOperations = {
    defaultUsername: () => 'testuser',
    currentDate: () => '2026-09-03',
    // The nutrilist routes are gated on this flag (see the router's NutriList
    // section) — without it the PUT below 404s at routing, not at the guard.
    nutritionItemsAvailable: true,
    updateNutritionItem: async (userId, uuid, changes) => {
      calls.update.push({ uuid, changes: { ...changes } });
      return operations.notFound ? null : { item: { uuid, ...changes }, changedFields: Object.keys(changes) };
    },
  };
  const router = createHealthRouter({
    healthOperations,
    catalogService,
    iconManifestStore: withManifest ? manifest() : null,
    logger: silent,
  });
  const app = express();
  app.use('/api/v1/health', router);
  return { app, calls };
}

describe('GET /api/v1/health/nutrition/icons — the picker vocabulary', () => {
  it('lists the offered slugs', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/icons');
    expect(res.status).toBe(200);
    expect(res.body.icons).toEqual(['avocado-toast', 'fried-eggs']);
    expect(res.body.count).toBe(2);
  });

  it('filters by ?q=', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/icons?q=egg');
    expect(res.body.icons).toEqual(['fried-eggs']);
  });

  it('honours ?limit=', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/icons?limit=1');
    expect(res.body.icons).toHaveLength(1);
  });

  it('returns an empty vocabulary (not a 500) when no manifest is installed', async () => {
    const { app } = makeApp({ withManifest: false });
    const res = await request(app).get('/api/v1/health/nutrition/icons');
    expect(res.status).toBe(200);
    expect(res.body.icons).toEqual([]);
  });
});

describe('PUT /api/v1/health/nutrition/catalog/icon — "always for this food"', () => {
  it('pins the icon by food name and returns the presented entry', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .put('/api/v1/health/nutrition/catalog/icon')
      .send({ name: 'Eggs', icon: 'fried-eggs' });
    expect(res.status).toBe(200);
    expect(res.body.entry.icon).toBe('fried-eggs');
    expect(calls.setIconByName).toEqual([{ name: 'Eggs', userId: 'testuser', icon: 'fried-eggs' }]);
  });

  it('pins by id when one is given', async () => {
    const { app, calls } = makeApp();
    await request(app).put('/api/v1/health/nutrition/catalog/icon').send({ id: 'e1', icon: 'fried-eggs' });
    expect(calls.setIcon).toHaveLength(1);
    expect(calls.setIconByName).toHaveLength(0);
  });

  it('accepts null to clear back to the neutral fallback', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).put('/api/v1/health/nutrition/catalog/icon').send({ name: 'Eggs', icon: null });
    expect(res.status).toBe(200);
    expect(calls.setIconByName[0].icon).toBeNull();
  });

  it('400s with neither id nor name', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/v1/health/nutrition/catalog/icon').send({ icon: 'fried-eggs' });
    expect(res.status).toBe(400);
  });

  // The load-bearing one: a slug the manifest does not offer would be stored,
  // 404 at the serving route forever, and show the fallback glyph with nothing
  // logged. Invisible once written, so it must be refused on the way in.
  it('400s on a slug the manifest does not know, and never reaches the catalog', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .put('/api/v1/health/nutrition/catalog/icon')
      .send({ name: 'Eggs', icon: 'pterodactyl-wing' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown icon/i);
    expect(calls.setIconByName).toHaveLength(0);
  });

  it('400s on a traversal-shaped icon value', async () => {
    const { app, calls } = makeApp();
    for (const icon of ['../../etc/passwd', '/etc/passwd', 'fried-eggs.png', 42, { path: 'x' }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).put('/api/v1/health/nutrition/catalog/icon').send({ name: 'Eggs', icon });
      expect(res.status).toBe(400);
    }
    expect(calls.setIconByName).toHaveLength(0);
  });

  it('404s for a food the catalog does not know', async () => {
    const { app } = makeApp({ catalog: { missing: true } });
    const res = await request(app)
      .put('/api/v1/health/nutrition/catalog/icon')
      .send({ name: 'Pterodactyl', icon: 'fried-eggs' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/health/nutrilist/:uuid — "just this entry"', () => {
  it('passes a known icon through to the update', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).put('/api/v1/health/nutrilist/row-1').send({ icon: 'fried-eggs' });
    expect(res.status).toBe(200);
    expect(calls.update[0].changes.icon).toBe('fried-eggs');
  });

  it('400s on an icon the manifest does not know, without touching the entry', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).put('/api/v1/health/nutrilist/row-1').send({ icon: 'pterodactyl-wing' });
    expect(res.status).toBe(400);
    expect(calls.update).toHaveLength(0);
  });

  it('normalizes an empty icon to null rather than storing an empty string', async () => {
    const { app, calls } = makeApp();
    await request(app).put('/api/v1/health/nutrilist/row-1').send({ icon: '' });
    expect(calls.update[0].changes.icon).toBeNull();
  });

  it('leaves a body with no icon key completely alone', async () => {
    const { app, calls } = makeApp();
    await request(app).put('/api/v1/health/nutrilist/row-1').send({ name: 'Renamed' });
    expect(Object.hasOwn(calls.update[0].changes, 'icon')).toBe(false);
  });
});
