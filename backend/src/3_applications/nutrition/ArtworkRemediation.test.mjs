// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlArtworkQueueStore } from '#adapters/persistence/yaml/YamlArtworkQueueStore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { NutritionRepairService } from './NutritionRepairService.mjs';
import { ArtworkRemediation } from './ArtworkRemediation.mjs';

const NOW = Date.parse('2026-09-23T17:00:00Z');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const row = (uuid, name, over = {}) => ({ userId: 'alice', uuid, id: uuid, name, date: '2026-09-22', mealTime: 'afternoon',
  calories: 100, protein: 1, carbs: 1, fat: 1, amount: 1, unit: 'serving', icon: 'default', settled: true, settledBy: 'user', ...over });

async function fixture({ rows = [], served = ['milkshake', 'strawberry', 'apple', 'yogurt'], foodNames = {}, ai = null, upc = null,
  photos = ['ph_good'], entries = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-queue-')); roots.push(root);
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const dataService = { user: { resolveDir: (relative, id) => path.join(root, id, relative) } };
  const items = new YamlNutriListDatastore({ dataService, logger });
  if (rows.length) await items.saveMany(rows);
  const clock = { now: () => NOW };
  const icons = { list: () => served, foodNames: () => foodNames, has: slug => served.includes(slug), resolve: slug => (served.includes(slug) ? { slug } : null) };
  const repairs = new NutritionRepairService({ items, clock, timezoneFor: () => 'America/Los_Angeles', icons });
  const catalogMap = new Map(entries.map(entry => [entry.id, entry]));
  const catalog = {
    getById: async id => catalogMap.get(id) || null,
    findByNormalizedName: async name => [...catalogMap.values()].find(entry => entry.matches(FoodCatalogEntry.normalize(name))) || null,
    save: vi.fn(async entry => { catalogMap.set(entry.id, entry); }),
  };
  const photoStore = { resolvePath: (_u, ref) => (photos.includes(ref) ? `/p/${ref}.jpg` : null), save: vi.fn(async () => 'ph_fresh') };
  const queue = new YamlArtworkQueueStore({ dataService });
  const remediation = new ArtworkRemediation({ queue, items, repairs, catalog, icons, aiGateway: ai, upcGateway: upc, photos: photoStore, clock, logger });
  return { root, items, repairs, remediation, queue, catalog, catalogMap, photoStore, logger, clock };
}

const entry = (over = {}) => new FoodCatalogEntry({ id: 'shake', name: 'Strawberry Milkshake', lastUsed: '2026-09-22', createdAt: '2026-09-17T00:00:00Z', ...over });

describe('ArtworkRemediation.sweep', () => {
  it('queues rows with no working art and leaves pins, photos and groups alone', async () => {
    const f = await fixture({ rows: [
      row('r1', 'Strawberry Milkshake', { foodId: 'shake' }),
      row('r2', 'Strawberry Milkshake', { foodId: 'shake', date: '2026-09-21' }),
      row('r3', 'Apple', { icon: 'apple' }),
      row('r4', 'Mystery', { photoRef: 'ph_good' }),
      row('r5', 'Old Pick', { icon: 'retired-flat', manualFields: ['icon'] }),
      row('r6', 'Lost Photo', { photoRef: 'ph_gone' }),
      row('r7', 'Unserved', { icon: 'retired-flat' }),
    ] });
    const dry = await f.remediation.sweep('alice', { sinceDays: 7, dryRun: true });
    expect(dry).toMatchObject({ broken: 4, enqueued: 0 });
    expect(f.queue.load('alice').items).toEqual({});

    const done = await f.remediation.sweep('alice', { sinceDays: 7 });
    expect(done.enqueued).toBe(3);
    const items = f.queue.load('alice').items;
    expect(Object.keys(items).sort()).toEqual(['food:shake', 'name:unserved', 'photo:ph_gone']);
    expect(items['food:shake']).toMatchObject({ kind: 'icon-missing', rowIds: ['r1', 'r2'], attempts: 0 });
    expect(items['name:unserved'].kind).toBe('icon-failed');
    expect(f.logger.info).toHaveBeenCalledWith('artwork.queue.enqueued', expect.objectContaining({ key: 'food:shake', kind: 'icon-missing' }));
  });
});

describe('ArtworkRemediation.tick', () => {
  it('fixes every row of a food with the closest icon, audited with Undo, and teaches the catalog', async () => {
    const shake = entry();
    const f = await fixture({ rows: [row('r1', 'Strawberry Milkshake', { foodId: 'shake', date: '2026-08-01' })], entries: [shake] });
    await f.remediation.sweep('alice', { sinceDays: 90 });
    expect(await f.remediation.tick('alice')).toEqual({ worked: 1, resolved: 1, retry: 0 });
    const fixed = await f.items.findByUuid('alice', 'r1');
    expect(fixed.icon).toBe('milkshake');
    expect(shake.icon).toBe('milkshake');
    const { records } = await f.items.listCleanupAudit('alice');
    expect(records[0]).toMatchObject({ actor: 'artwork-remediation', evidence: [expect.objectContaining({ kind: 'artwork', via: 'name' })] });
    expect(f.remediation.view('alice')).toMatchObject({ open: [], recentlyResolved: [{ key: 'food:shake', resolution: { via: 'name', icon: 'milkshake', rows: 1 } }] });
    expect(f.logger.info).toHaveBeenCalledWith('artwork.queue.resolved', expect.objectContaining({ key: 'food:shake', attempts: 1 }));

    await f.repairs.undo({ userId: 'alice', repairId: records[0].id, operationId: 'undo-1' });
    const undone = await f.items.findByUuid('alice', 'r1');
    expect(undone.icon).toBe('default');
    expect(undone.manualFields).toContain('icon');
    // The person's Undo is a choice: the next sweep does not re-queue it.
    expect((await f.remediation.sweep('alice', { sinceDays: 90, dryRun: true })).broken).toBe(0);
  });

  it('asks the AI for the NEAREST icon, confined to the manifest', async () => {
    const ai = { chat: vi.fn(async () => '{ "icon": "yogurt" }') };
    const f = await fixture({ rows: [row('r1', 'Skyr Cup')], ai });
    await f.remediation.sweep('alice');
    await f.remediation.tick('alice');
    expect((await f.items.findByUuid('alice', 'r1')).icon).toBe('yogurt');
    expect(ai.chat.mock.calls[0][0][0].content).toMatch(/NEAREST/);
  });

  it('a failed attempt is kept, backed off and retried — never dropped', async () => {
    const ai = { chat: vi.fn(async () => '{ "icon": "made-up-slug" }') };
    const f = await fixture({ rows: [row('r1', 'Skyr Cup')], ai });
    await f.remediation.sweep('alice');
    expect(await f.remediation.tick('alice')).toEqual({ worked: 1, resolved: 0, retry: 1 });
    const [item] = f.remediation.view('alice').open;
    expect(item).toMatchObject({ attempts: 1, nextAttemptAt: new Date(NOW + 60_000).toISOString() });
    expect(item.lastError).toMatch(/not a served icon/);
    expect(f.logger.warn).toHaveBeenCalledWith('artwork.queue.retry', expect.objectContaining({ key: 'name:skyr cup', attempts: 1 }));
    // Not due yet.
    expect(await f.remediation.tick('alice')).toEqual({ worked: 0, resolved: 0, retry: 0 });
    f.clock.now = () => NOW + 61_000;
    ai.chat.mockResolvedValueOnce('{"icon":"yogurt"}');
    expect(await f.remediation.tick('alice')).toMatchObject({ resolved: 1 });
  });

  it('an exact-only food never gets a near neighbour: product photo, else it stays open', async () => {
    const ai = { chat: vi.fn(async () => '{"icon":"yogurt"}') };
    const f = await fixture({ rows: [row('r1', 'Oikos Pro Plain', { foodId: 'oikos' })], ai });
    await f.remediation.sweep('alice');
    await f.remediation.tick('alice');
    expect(ai.chat).not.toHaveBeenCalled();
    expect(f.remediation.view('alice').open[0]).toMatchObject({ key: 'food:oikos', attempts: 1 });
    expect(f.remediation.view('alice').open[0].lastError).toMatch(/exact icon/);

    const g = await fixture({ rows: [row('r1', 'Oikos Pro Plain', { foodId: 'oikos' })],
      entries: [new FoodCatalogEntry({ id: 'oikos', name: 'Oikos Pro Plain', photoRef: 'ph_good', lastUsed: '2026-09-22', createdAt: 'x' })] });
    await g.remediation.sweep('alice');
    await g.remediation.tick('alice');
    expect((await g.items.findByUuid('alice', 'r1')).photoRef).toBe('ph_good');
    expect(g.remediation.view('alice').recentlyResolved[0].resolution).toMatchObject({ via: 'photo', photoRef: 'ph_good' });
  });

  it('a broken barcode photo is fetched again from the UPC gateway', async () => {
    const upc = { lookup: vi.fn(async () => ({ imageUrl: 'https://img/p.jpg' })), fetchImage: vi.fn(async () => Buffer.from('jpeg')) };
    const shake = entry({ photoRef: 'ph_gone' });
    const f = await fixture({ upc, entries: [shake], rows: [row('r1', 'Strawberry Milkshake', { foodId: 'shake', photoRef: 'ph_gone',
      captureEvidence: { source: 'upc', upc: '749826002033' } })] });
    await f.remediation.report('alice', { kind: 'photo-failed', key: 'ph_gone', uuid: 'r1' });
    await f.remediation.tick('alice');
    expect(upc.lookup).toHaveBeenCalledWith('749826002033');
    expect((await f.items.findByUuid('alice', 'r1')).photoRef).toBe('ph_fresh');
    expect(shake.photoRef).toBe('ph_fresh');
  });

  it('a broken photo with no barcode gets a real icon and loses the dead ref', async () => {
    const f = await fixture({ rows: [row('r1', 'Apple Slices', { photoRef: 'ph_gone' })] });
    await f.remediation.report('alice', { kind: 'photo-failed', key: 'ph_gone', uuid: 'r1' });
    await f.remediation.tick('alice');
    expect(await f.items.findByUuid('alice', 'r1')).toMatchObject({ icon: 'apple', photoRef: null });
  });

  it('a slug the browser could not render, with no row, fans out to the foods that use it', async () => {
    const f = await fixture({ rows: [row('r1', 'Apple Pie', { icon: 'pie-slice' })] });
    await f.remediation.report('alice', { kind: 'icon-failed', key: 'pie-slice' });
    await f.remediation.tick('alice');
    expect(f.queue.load('alice').items['icon:pie-slice'].resolution).toMatchObject({ via: 'expanded', rows: 1 });
    await f.remediation.tick('alice');
    expect((await f.items.findByUuid('alice', 'r1')).icon).toBe('apple');
  });
});
