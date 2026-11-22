// tests/isolated/adapter/weekly-review/FilesystemWeeklyReviewStore.showcase.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemWeeklyReviewStore } from '../../../../__app_modules/personal/weekly-review/server/adapters/persistence/FilesystemWeeklyReviewStore.mjs';

describe('FilesystemWeeklyReviewStore school showcase cache', () => {
  let root;
  let store;
  const logger = { debug() {}, info() {}, warn() {}, error() {} };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-showcase-'));
    store = new FilesystemWeeklyReviewStore({ householdDir: path.join(root, 'household'), mediaPath: path.join(root, 'media'), logger });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('is null before anything is saved', () => {
    expect(store.loadSchoolShowcase('2026-03-23')).toBeNull();
  });

  it('round-trips as YAML beside the week\'s review files', () => {
    const data = { 'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['Finished Holes', 'Read: "Matilda" · 3 sessions'], at: '2026-03-30T20:00:00.000Z' } };
    store.saveSchoolShowcase('2026-03-23', data);
    const file = path.join(root, 'household', 'weekly-review', 'log', '2026-03-23', 'school-showcase.yml');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^kid-a:\n {2}itemsHash:/);
    expect(store.loadSchoolShowcase('2026-03-23')).toEqual(data);
  });

  it('replaces the cache whole, leaving no staging file behind', () => {
    store.saveSchoolShowcase('2026-03-23', { 'kid-a': { itemsHash: 'a', bullets: ['One'], at: 'x' } });
    const rejected = { 'kid-a': { itemsHash: 'b', bullets: null, rejectedAt: 'y', attempts: 1 } };
    store.saveSchoolShowcase('2026-03-23', rejected);
    expect(store.loadSchoolShowcase('2026-03-23')).toEqual(rejected);
    const dir = path.join(root, 'household', 'weekly-review', 'log', '2026-03-23');
    expect(fs.readdirSync(dir)).toEqual(['school-showcase.yml']);
  });
});
