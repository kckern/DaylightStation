/**
 * Admin Content Router - Section Operations Integration Tests
 *
 * Tests the CRUD and section manipulation endpoints of admin/content.mjs
 * against real YAML file I/O using a temp directory.
 *
 * Covers:
 * - List CRUD (create, get, update settings, delete)
 * - Section operations (add, split, reorder, update, delete)
 * - Item operations (add, update, delete, move between sections)
 * - Normalizer round-trip (save + reload preserves structure)
 *
 * Prerequisite for extracting ListManagementService (Task 13).
 */

import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { createAdminContentRouter } from '#api/v1/routers/admin/content.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir;
let app;

/** Minimal error-handling middleware that maps httpStatus from domain errors */
function testErrorHandler(err, req, res, _next) {
  const status = err.httpStatus || 500;
  res.status(status).json({ ok: false, error: err.message, code: err.code });
}

function buildApp(householdDir) {
  const a = express();
  a.use(express.json());

  const router = createAdminContentRouter({
    userDataService: {
      getHouseholdDir: () => householdDir,
    },
    configService: {
      getDefaultHouseholdId: () => 'test-household',
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });

  a.use('/admin/content', router);
  a.use(testErrorHandler);
  return a;
}

/** Write a YAML file directly into the temp lists directory */
function writeListYaml(type, name, data) {
  const dir = path.join(tmpDir, 'config', 'lists', type);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.yml`);
  fs.writeFileSync(filePath, yaml.dump(data), 'utf8');
}

/** Read a YAML file from the temp lists directory */
function readListYaml(type, name) {
  const filePath = path.join(tmpDir, 'config', 'lists', type, `${name}.yml`);
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-admin-content-'));
  app = buildApp(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// LIST CRUD
// ===========================================================================

describe('List CRUD', () => {
  test('POST /lists/:type creates a new empty list', async () => {
    const res = await request(app)
      .post('/admin/content/lists/menus')
      .send({ name: 'My New Menu' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.list).toBe('my-new-menu');

    // Verify file was created on disk
    const onDisk = readListYaml('menus', 'my-new-menu');
    expect(onDisk).toBeDefined();
    expect(onDisk.items).toEqual([]);
  });

  test('POST /lists/:type returns 409 for duplicate name', async () => {
    writeListYaml('menus', 'existing', { items: [] });

    const res = await request(app)
      .post('/admin/content/lists/menus')
      .send({ name: 'existing' });

    expect(res.status).toBe(409);
  });

  test('POST /lists/:type returns 400 for invalid type', async () => {
    const res = await request(app)
      .post('/admin/content/lists/bogus')
      .send({ name: 'test' });

    expect(res.status).toBe(400);
  });

  test('POST /lists/:type returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/admin/content/lists/menus')
      .send({});

    expect(res.status).toBe(400);
  });

  test('GET /lists returns overview of all types', async () => {
    writeListYaml('menus', 'alpha', { items: [{ title: 'A', play: { contentId: 'plex:1' } }] });
    writeListYaml('menus', 'beta', { items: [] });
    writeListYaml('watchlists', 'shows', { items: [{ title: 'S1', play: { contentId: 'plex:2' } }] });

    const res = await request(app).get('/admin/content/lists');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);

    const menusSummary = res.body.types.find(t => t.type === 'menus');
    expect(menusSummary.count).toBe(2);

    const watchlistsSummary = res.body.types.find(t => t.type === 'watchlists');
    expect(watchlistsSummary.count).toBe(1);
  });

  test('GET /lists/:type lists all lists of a type with item counts', async () => {
    writeListYaml('programs', 'morning', {
      items: [
        { title: 'Item 1', play: { contentId: 'plex:10' } },
        { title: 'Item 2', play: { contentId: 'plex:20' } },
      ]
    });
    writeListYaml('programs', 'evening', { items: [] });

    const res = await request(app).get('/admin/content/lists/programs');

    expect(res.status).toBe(200);
    expect(res.body.lists).toHaveLength(2);

    const morning = res.body.lists.find(l => l.name === 'morning');
    expect(morning.itemCount).toBe(2);

    const evening = res.body.lists.find(l => l.name === 'evening');
    expect(evening.itemCount).toBe(0);
  });

  test('GET /lists/:type/:name returns full list with sections', async () => {
    writeListYaml('menus', 'test-list', {
      title: 'Test List',
      description: 'A test',
      items: [
        { title: 'Item A', play: { contentId: 'plex:100' } },
        { title: 'Item B', open: 'settings' },
      ]
    });

    const res = await request(app).get('/admin/content/lists/menus/test-list');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test List');
    expect(res.body.description).toBe('A test');
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0].items).toHaveLength(2);
    expect(res.body.sections[0].items[0].title).toBe('Item A');
  });

  test('GET /lists/:type/:name returns 404 for missing list', async () => {
    const res = await request(app).get('/admin/content/lists/menus/nonexistent');

    expect(res.status).toBe(404);
  });

  test('PUT /lists/:type/:name/settings updates metadata', async () => {
    writeListYaml('watchlists', 'my-shows', {
      title: 'My Shows',
      items: [{ title: 'Show 1', play: { contentId: 'plex:50' } }]
    });

    const res = await request(app)
      .put('/admin/content/lists/watchlists/my-shows/settings')
      .send({ title: 'Updated Title', description: 'New desc', sorting: 'alpha' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');

    // Verify on disk
    const onDisk = readListYaml('watchlists', 'my-shows');
    expect(onDisk.title).toBe('Updated Title');
    expect(onDisk.description).toBe('New desc');
    expect(onDisk.metadata.sorting).toBe('alpha');
  });

  test('DELETE /lists/:type/:name removes the list', async () => {
    writeListYaml('menus', 'to-delete', { items: [] });

    const res = await request(app).delete('/admin/content/lists/menus/to-delete');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // File should be gone
    const onDisk = readListYaml('menus', 'to-delete');
    expect(onDisk).toBeNull();
  });

  test('DELETE /lists/:type/:name returns 404 for missing list', async () => {
    const res = await request(app).delete('/admin/content/lists/menus/ghost');

    expect(res.status).toBe(404);
  });

  test('PUT /lists/:type/:name replaces list contents (reorder)', async () => {
    writeListYaml('menus', 'reorder-test', {
      title: 'Reorder',
      items: [
        { title: 'First', play: { contentId: 'plex:1' } },
        { title: 'Second', play: { contentId: 'plex:2' } },
        { title: 'Third', play: { contentId: 'plex:3' } },
      ]
    });

    // Reverse the order
    const res = await request(app)
      .put('/admin/content/lists/menus/reorder-test')
      .send({
        items: [
          { title: 'Third', play: { contentId: 'plex:3' } },
          { title: 'Second', play: { contentId: 'plex:2' } },
          { title: 'First', play: { contentId: 'plex:1' } },
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(3);

    // Verify new order on disk
    const onDisk = readListYaml('menus', 'reorder-test');
    expect(onDisk.items[0].title).toBe('Third');
    expect(onDisk.items[2].title).toBe('First');
  });
});

// ===========================================================================
// ITEM OPERATIONS
// ===========================================================================

describe('Item operations', () => {
  beforeEach(() => {
    writeListYaml('watchlists', 'item-ops', {
      title: 'Item Ops',
      items: [
        { title: 'Alpha', play: { contentId: 'plex:10' } },
        { title: 'Beta', play: { contentId: 'plex:20' } },
        { title: 'Gamma', play: { contentId: 'plex:30' } },
      ]
    });
  });

  test('POST /lists/:type/:name/items adds item to end', async () => {
    const res = await request(app)
      .post('/admin/content/lists/watchlists/item-ops/items')
      .send({ label: 'Delta', input: 'plex:40', action: 'Play' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.index).toBe(3);

    const onDisk = readListYaml('watchlists', 'item-ops');
    expect(onDisk.items).toHaveLength(4);
    expect(onDisk.items[3].label).toBe('Delta');
  });

  test('POST /lists/:type/:name/items returns 400 without label', async () => {
    const res = await request(app)
      .post('/admin/content/lists/watchlists/item-ops/items')
      .send({ input: 'plex:99' });

    expect(res.status).toBe(400);
  });

  test('PUT /lists/:type/:name/items/:index updates item fields', async () => {
    const res = await request(app)
      .put('/admin/content/lists/watchlists/item-ops/items/1')
      .send({ label: 'Beta Updated', active: false });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the update: label is the admin-editable field, title is the normalized field.
    // The PUT endpoint stores label as a distinct field alongside normalized title.
    // On GET, denormalizeForAdmin preserves the stored label if present.
    const getRes = await request(app).get('/admin/content/lists/watchlists/item-ops');
    const updatedItem = getRes.body.sections[0].items[1];
    expect(updatedItem.label).toBe('Beta Updated');
    expect(updatedItem.active).toBe(false);
    // Original title from normalizer is preserved (label is the admin display name)
    expect(updatedItem.title).toBe('Beta');
  });

  test('PUT /lists/:type/:name/items/:index returns 404 for out-of-range', async () => {
    const res = await request(app)
      .put('/admin/content/lists/watchlists/item-ops/items/99')
      .send({ label: 'Nope' });

    expect(res.status).toBe(404);
  });

  test('DELETE /lists/:type/:name/items/:index removes an item', async () => {
    const res = await request(app)
      .delete('/admin/content/lists/watchlists/item-ops/items/1');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const onDisk = readListYaml('watchlists', 'item-ops');
    expect(onDisk.items).toHaveLength(2);
    // Beta should be gone; remaining: Alpha, Gamma
    expect(onDisk.items[0].title).toBe('Alpha');
    expect(onDisk.items[1].title).toBe('Gamma');
  });

  test('DELETE /lists/:type/:name/items/:index returns 404 for out-of-range', async () => {
    const res = await request(app)
      .delete('/admin/content/lists/watchlists/item-ops/items/99');

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// SECTION OPERATIONS
// ===========================================================================

describe('Section operations', () => {
  /** Seed a multi-section list */
  function seedSections() {
    writeListYaml('programs', 'multi-section', {
      title: 'Multi Section',
      sections: [
        {
          title: 'Morning',
          items: [
            { title: 'Devotional', play: { contentId: 'local:dev1' } },
            { title: 'Scripture', play: { contentId: 'local:script1' } },
            { title: 'Hymn', play: { contentId: 'local:hymn1' } },
            { title: 'Prayer', play: { contentId: 'local:pray1' } },
          ]
        },
        {
          title: 'Afternoon',
          items: [
            { title: 'Podcast', play: { contentId: 'plex:pod1' } },
            { title: 'Music', play: { contentId: 'plex:mus1' } },
          ]
        },
        {
          title: 'Evening',
          items: [
            { title: 'Show', play: { contentId: 'plex:show1' } },
          ]
        },
      ]
    });
  }

  test('POST /lists/:type/:name/sections adds empty section', async () => {
    seedSections();

    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections')
      .send({ title: 'Night' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.sectionIndex).toBe(3);

    // Verify on disk
    const onDisk = readListYaml('programs', 'multi-section');
    expect(onDisk.sections).toHaveLength(4);
    expect(onDisk.sections[3].title).toBe('Night');
    expect(onDisk.sections[3].items).toEqual([]);
  });

  test('POST /lists/:type/:name/sections ignores items in payload (prevents injection)', async () => {
    seedSections();

    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections')
      .send({ title: 'Injected', items: [{ title: 'Bad', play: { contentId: 'evil:1' } }] });

    expect(res.status).toBe(201);

    const onDisk = readListYaml('programs', 'multi-section');
    const newSection = onDisk.sections[onDisk.sections.length - 1];
    expect(newSection.items).toEqual([]);
  });

  test('POST /lists/:type/:name/sections/split splits section correctly', async () => {
    seedSections();

    // Split Morning section after item index 1 (keep Devotional+Scripture, move Hymn+Prayer)
    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections/split')
      .send({ sectionIndex: 0, afterItemIndex: 1, title: 'Late Morning' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.newSectionIndex).toBe(1);
    expect(res.body.movedCount).toBe(2);

    // Verify on disk: should now have 4 sections
    const onDisk = readListYaml('programs', 'multi-section');
    expect(onDisk.sections).toHaveLength(4);

    // Original section kept first 2 items
    expect(onDisk.sections[0].title).toBe('Morning');
    expect(onDisk.sections[0].items).toHaveLength(2);
    expect(onDisk.sections[0].items[0].title).toBe('Devotional');
    expect(onDisk.sections[0].items[1].title).toBe('Scripture');

    // New section got the remaining 2 items
    expect(onDisk.sections[1].title).toBe('Late Morning');
    expect(onDisk.sections[1].items).toHaveLength(2);
    expect(onDisk.sections[1].items[0].title).toBe('Hymn');
    expect(onDisk.sections[1].items[1].title).toBe('Prayer');

    // Original sections shifted down
    expect(onDisk.sections[2].title).toBe('Afternoon');
    expect(onDisk.sections[3].title).toBe('Evening');
  });

  test('POST /sections/split returns 400 when afterItemIndex at last item', async () => {
    seedSections();

    // Splitting after the last item means nothing to move
    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections/split')
      .send({ sectionIndex: 0, afterItemIndex: 3 });

    expect(res.status).toBe(400);
  });

  test('POST /sections/split returns 400 when afterItemIndex beyond last item', async () => {
    seedSections();

    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections/split')
      .send({ sectionIndex: 0, afterItemIndex: 99 });

    expect(res.status).toBe(400);
  });

  test('POST /sections/split returns 400 when afterItemIndex is missing', async () => {
    seedSections();

    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections/split')
      .send({ sectionIndex: 0 });

    expect(res.status).toBe(400);
  });

  test('POST /sections/split returns 404 for invalid sectionIndex', async () => {
    seedSections();

    const res = await request(app)
      .post('/admin/content/lists/programs/multi-section/sections/split')
      .send({ sectionIndex: 99, afterItemIndex: 0 });

    expect(res.status).toBe(404);
  });

  test('PUT /lists/:type/:name/sections/reorder reorders sections', async () => {
    seedSections();

    // Reverse: Evening(2), Afternoon(1), Morning(0)
    const res = await request(app)
      .put('/admin/content/lists/programs/multi-section/sections/reorder')
      .send({ order: [2, 1, 0] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const onDisk = readListYaml('programs', 'multi-section');
    expect(onDisk.sections[0].title).toBe('Evening');
    expect(onDisk.sections[1].title).toBe('Afternoon');
    expect(onDisk.sections[2].title).toBe('Morning');
  });

  test('PUT /sections/reorder drops invalid indices silently', async () => {
    seedSections();

    // Include an out-of-bounds index (99) - should be filtered out
    const res = await request(app)
      .put('/admin/content/lists/programs/multi-section/sections/reorder')
      .send({ order: [2, 99, 0] });

    expect(res.status).toBe(200);

    const onDisk = readListYaml('programs', 'multi-section');
    // Only valid indices kept: Evening(2), Morning(0) — Afternoon(1) dropped
    expect(onDisk.sections).toHaveLength(2);
    expect(onDisk.sections[0].title).toBe('Evening');
    expect(onDisk.sections[1].title).toBe('Morning');
  });

  test('PUT /sections/reorder returns 400 without order array', async () => {
    seedSections();

    const res = await request(app)
      .put('/admin/content/lists/programs/multi-section/sections/reorder')
      .send({});

    expect(res.status).toBe(400);
  });

  test('PUT /lists/:type/:name/sections/:sectionIndex updates section settings', async () => {
    seedSections();

    const res = await request(app)
      .put('/admin/content/lists/programs/multi-section/sections/1')
      .send({ title: 'Midday', shuffle: true, continuous: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sectionIndex).toBe(1);

    const onDisk = readListYaml('programs', 'multi-section');
    expect(onDisk.sections[1].title).toBe('Midday');
    expect(onDisk.sections[1].shuffle).toBe(true);
    expect(onDisk.sections[1].continuous).toBe(true);
    // Items should be preserved
    expect(onDisk.sections[1].items).toHaveLength(2);
  });

  test('PUT /sections/:sectionIndex returns 404 for invalid index', async () => {
    seedSections();

    const res = await request(app)
      .put('/admin/content/lists/programs/multi-section/sections/99')
      .send({ title: 'Nope' });

    expect(res.status).toBe(404);
  });

  test('DELETE /lists/:type/:name/sections/:sectionIndex removes section', async () => {
    seedSections();

    // Delete Afternoon (index 1)
    const res = await request(app)
      .delete('/admin/content/lists/programs/multi-section/sections/1');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const onDisk = readListYaml('programs', 'multi-section');
    expect(onDisk.sections).toHaveLength(2);
    expect(onDisk.sections[0].title).toBe('Morning');
    expect(onDisk.sections[1].title).toBe('Evening');
  });

  test('DELETE last section replaces it with an empty section', async () => {
    // Single-section list stored in sections format
    writeListYaml('programs', 'single-section', {
      title: 'Solo',
      sections: [
        {
          title: 'Only',
          items: [{ title: 'A', play: { contentId: 'x:1' } }]
        }
      ]
    });

    const res = await request(app)
      .delete('/admin/content/lists/programs/single-section/sections/0');

    expect(res.status).toBe(200);

    const onDisk = readListYaml('programs', 'single-section');
    // Should have one empty section after deleting the last one
    expect(onDisk.items).toBeDefined();
    expect(onDisk.items).toEqual([]);
  });

  test('DELETE /sections/:sectionIndex returns 404 for invalid index', async () => {
    seedSections();

    const res = await request(app)
      .delete('/admin/content/lists/programs/multi-section/sections/99');

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// ITEM MOVE BETWEEN SECTIONS
// ===========================================================================

describe('Item move between sections', () => {
  beforeEach(() => {
    writeListYaml('programs', 'move-test', {
      title: 'Move Test',
      sections: [
        {
          title: 'Source',
          items: [
            { title: 'Stay1', play: { contentId: 'x:1' } },
            { title: 'MoveMe', play: { contentId: 'x:2' } },
            { title: 'Stay2', play: { contentId: 'x:3' } },
          ]
        },
        {
          title: 'Target',
          items: [
            { title: 'Existing', play: { contentId: 'x:10' } },
          ]
        },
      ]
    });
  });

  test('PUT /items/move moves item from one section to another', async () => {
    const res = await request(app)
      .put('/admin/content/lists/programs/move-test/items/move')
      .send({
        from: { section: 0, index: 1 },
        to: { section: 1, index: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const onDisk = readListYaml('programs', 'move-test');

    // Source should have 2 items (MoveMe removed)
    expect(onDisk.sections[0].items).toHaveLength(2);
    expect(onDisk.sections[0].items[0].title).toBe('Stay1');
    expect(onDisk.sections[0].items[1].title).toBe('Stay2');

    // Target should have 2 items (MoveMe inserted at index 0)
    expect(onDisk.sections[1].items).toHaveLength(2);
    expect(onDisk.sections[1].items[0].title).toBe('MoveMe');
    expect(onDisk.sections[1].items[1].title).toBe('Existing');
  });

  test('PUT /items/move can move item to end of target section', async () => {
    const res = await request(app)
      .put('/admin/content/lists/programs/move-test/items/move')
      .send({
        from: { section: 0, index: 0 },
        to: { section: 1, index: 1 },
      });

    expect(res.status).toBe(200);

    const onDisk = readListYaml('programs', 'move-test');
    expect(onDisk.sections[1].items).toHaveLength(2);
    expect(onDisk.sections[1].items[1].title).toBe('Stay1');
  });

  test('PUT /items/move returns 400 without from/to', async () => {
    const res = await request(app)
      .put('/admin/content/lists/programs/move-test/items/move')
      .send({});

    expect(res.status).toBe(400);
  });

  test('PUT /items/move returns 404 for invalid section index', async () => {
    const res = await request(app)
      .put('/admin/content/lists/programs/move-test/items/move')
      .send({
        from: { section: 99, index: 0 },
        to: { section: 1, index: 0 },
      });

    expect(res.status).toBe(404);
  });

  test('PUT /items/move returns 404 for invalid item index', async () => {
    const res = await request(app)
      .put('/admin/content/lists/programs/move-test/items/move')
      .send({
        from: { section: 0, index: 99 },
        to: { section: 1, index: 0 },
      });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// NORMALIZER ROUND-TRIP
// ===========================================================================

describe('Normalizer round-trip', () => {
  test('flat items format: save via API then reload produces consistent structure', async () => {
    // Create a list via API
    await request(app)
      .post('/admin/content/lists/menus')
      .send({ name: 'round-trip' });

    // Add items via API
    await request(app)
      .post('/admin/content/lists/menus/round-trip/items')
      .send({ label: 'Item A', input: 'plex:100', action: 'Play' });

    await request(app)
      .post('/admin/content/lists/menus/round-trip/items')
      .send({ label: 'Item B', input: 'app:settings', action: 'Open' });

    // Read via API
    const get1 = await request(app).get('/admin/content/lists/menus/round-trip');
    expect(get1.status).toBe(200);
    expect(get1.body.sections[0].items).toHaveLength(2);

    // Read again — structure should be identical
    const get2 = await request(app).get('/admin/content/lists/menus/round-trip');
    expect(get2.body.sections).toEqual(get1.body.sections);
  });

  test('sections format: split + reload preserves all items', async () => {
    writeListYaml('programs', 'round-trip-split', {
      title: 'Split Round Trip',
      items: [
        { title: 'A', play: { contentId: 'x:1' } },
        { title: 'B', play: { contentId: 'x:2' } },
        { title: 'C', play: { contentId: 'x:3' } },
        { title: 'D', play: { contentId: 'x:4' } },
      ]
    });

    // Split after item 1 (keep A+B, move C+D)
    const splitRes = await request(app)
      .post('/admin/content/lists/programs/round-trip-split/sections/split')
      .send({ sectionIndex: 0, afterItemIndex: 1, title: 'Part 2' });

    expect(splitRes.status).toBe(201);

    // Reload and verify total item count is preserved
    const getRes = await request(app).get('/admin/content/lists/programs/round-trip-split');
    expect(getRes.status).toBe(200);

    const totalItems = getRes.body.sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalItems).toBe(4);

    expect(getRes.body.sections).toHaveLength(2);
    expect(getRes.body.sections[0].items).toHaveLength(2);
    expect(getRes.body.sections[1].items).toHaveLength(2);
  });

  test('sections format: reorder + reload preserves all data', async () => {
    writeListYaml('programs', 'round-trip-reorder', {
      title: 'Reorder Round Trip',
      sections: [
        { title: 'A', items: [{ title: 'A1', play: { contentId: 'x:1' } }] },
        { title: 'B', items: [{ title: 'B1', play: { contentId: 'x:2' } }, { title: 'B2', play: { contentId: 'x:3' } }] },
        { title: 'C', items: [{ title: 'C1', play: { contentId: 'x:4' } }] },
      ]
    });

    // Reorder: C, A, B
    await request(app)
      .put('/admin/content/lists/programs/round-trip-reorder/sections/reorder')
      .send({ order: [2, 0, 1] });

    const getRes = await request(app).get('/admin/content/lists/programs/round-trip-reorder');
    expect(getRes.status).toBe(200);
    expect(getRes.body.sections).toHaveLength(3);
    expect(getRes.body.sections[0].title).toBe('C');
    expect(getRes.body.sections[1].title).toBe('A');
    expect(getRes.body.sections[2].title).toBe('B');

    // Total items preserved
    const totalItems = getRes.body.sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalItems).toBe(4);
  });

  test('move item + reload preserves total count', async () => {
    writeListYaml('programs', 'round-trip-move', {
      title: 'Move Round Trip',
      sections: [
        { title: 'From', items: [{ title: 'X', play: { contentId: 'x:1' } }, { title: 'Y', play: { contentId: 'x:2' } }] },
        { title: 'To', items: [{ title: 'Z', play: { contentId: 'x:3' } }] },
      ]
    });

    await request(app)
      .put('/admin/content/lists/programs/round-trip-move/items/move')
      .send({ from: { section: 0, index: 0 }, to: { section: 1, index: 1 } });

    const getRes = await request(app).get('/admin/content/lists/programs/round-trip-move');
    const totalItems = getRes.body.sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalItems).toBe(3);

    expect(getRes.body.sections[0].items).toHaveLength(1);
    expect(getRes.body.sections[0].items[0].title).toBe('Y');
    expect(getRes.body.sections[1].items).toHaveLength(2);
    expect(getRes.body.sections[1].items[1].title).toBe('X');
  });
});

// ===========================================================================
// COMPACT vs SECTIONS SERIALIZATION
// ===========================================================================

describe('Serialization format', () => {
  test('single section with no config uses compact items format', async () => {
    writeListYaml('menus', 'compact-test', {
      items: [
        { title: 'A', play: { contentId: 'x:1' } },
      ]
    });

    // Update settings (triggers re-serialize)
    await request(app)
      .put('/admin/content/lists/menus/compact-test/settings')
      .send({ title: 'Compact' });

    const onDisk = readListYaml('menus', 'compact-test');
    // Should use compact format (items, not sections)
    expect(onDisk.items).toBeDefined();
    expect(onDisk.sections).toBeUndefined();
  });

  test('multi-section list uses sections format', async () => {
    writeListYaml('programs', 'multi-fmt', {
      sections: [
        { title: 'A', items: [{ title: 'A1', play: { contentId: 'x:1' } }] },
        { title: 'B', items: [{ title: 'B1', play: { contentId: 'x:2' } }] },
      ]
    });

    // Trigger re-serialize via settings update
    await request(app)
      .put('/admin/content/lists/programs/multi-fmt/settings')
      .send({ title: 'Multi' });

    const onDisk = readListYaml('programs', 'multi-fmt');
    expect(onDisk.sections).toBeDefined();
    expect(onDisk.items).toBeUndefined();
  });

  test('section with title forces sections format even when single', async () => {
    writeListYaml('programs', 'titled-section', {
      sections: [
        { title: 'Only Section', items: [{ title: 'Item', play: { contentId: 'x:1' } }] },
      ]
    });

    // Trigger re-serialize
    await request(app)
      .put('/admin/content/lists/programs/titled-section/settings')
      .send({ title: 'Titled' });

    const onDisk = readListYaml('programs', 'titled-section');
    // Section has title (config), so should use sections format
    expect(onDisk.sections).toBeDefined();
    expect(onDisk.sections).toHaveLength(1);
    expect(onDisk.sections[0].title).toBe('Only Section');
  });
});
