import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkylineInvadersLevelCatalog } from './SkylineInvadersLevelCatalog.mjs';

let root;
const dir = () => path.join(root, 'fitness/skyline-invaders');
const put = (relative, value) => { const file = path.join(dir(), relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump(value)); };
const level = (id, over = {}) => ({ schema: 'skyline-invaders-level/v1', id, name: id, duration_s: 60, pass: { kills: 3 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }], ...over });
const catalog = (logger) => new SkylineInvadersLevelCatalog({ configService: { getHouseholdPath: (relative) => path.join(root, relative) }, logger });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'invaders-levels-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('SkylineInvadersLevelCatalog', () => {
  it('returns no levels when the household folder is empty or missing', () => {
    expect(catalog().list('home')).toEqual([]);
    expect(catalog().world('home')).toEqual({ levels: [] });
  });
  it('orders levels by world.yml, then unlisted levels by id', () => {
    for (const id of ['invaders-c', 'invaders-a', 'invaders-b', 'invaders-z']) put(`levels/${id}.yml`, level(id));
    put('world.yml', { levels: ['invaders-b', 'invaders-a', 'invaders-missing'] });
    expect(catalog().list('home').map((l) => l.id)).toEqual(['invaders-b', 'invaders-a', 'invaders-c', 'invaders-z']);
    expect(catalog().world('home').levels[0]).toEqual({ id: 'invaders-b', name: 'invaders-b' });
  });
  it('skips and logs a malformed level without hiding the rest', () => {
    const logger = { warn: vi.fn() };
    put('levels/good.yml', level('invaders-good'));
    put('levels/bad.yml', level('invaders-bad', { waves: [] }));
    put('levels/other.yml', { schema: 'skyline-glider-course/v1', id: 'x' });
    expect(catalog(logger).list('home').map((l) => l.id)).toEqual(['invaders-good']);
    expect(logger.warn).toHaveBeenCalledWith('fitness.skyline_invaders.level.invalid', expect.objectContaining({ file: 'bad.yml' }));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['a missing name', { name: undefined }],
    ['a zero duration', { duration_s: 0 }],
    ['a fractional kill target', { pass: { kills: 2.5 } }],
    ['an id that is not a slug', { id: 'Bad Id' }],
  ])('rejects a level with %s', (_label, over) => {
    const logger = { warn: vi.fn() };
    put('levels/level.yml', level('invaders-x', over));
    expect(catalog(logger).list('home')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
  it('skips a file that is not parseable YAML', () => {
    const logger = { warn: vi.fn() };
    put('levels/good.yml', level('invaders-good'));
    fs.writeFileSync(path.join(dir(), 'levels/broken.yml'), 'id: [unclosed');
    expect(catalog(logger).list('home').map((l) => l.id)).toEqual(['invaders-good']);
    expect(logger.warn).toHaveBeenCalledWith('fitness.skyline_invaders.level.invalid', { file: 'broken.yml', id: null });
  });
  it('ignores a world.yml that is not a list of ids', () => {
    put('levels/a.yml', level('invaders-a'));
    put('world.yml', { levels: 'invaders-a' });
    expect(catalog().list('home').map((l) => l.id)).toEqual(['invaders-a']);
  });
  it('lists a level once when world.yml names it twice', () => {
    put('levels/a.yml', level('invaders-a'));
    put('world.yml', { levels: ['invaders-a', 'invaders-a'] });
    expect(catalog().list('home').map((l) => l.id)).toEqual(['invaders-a']);
  });
  it('reads the folder on every call', () => {
    const subject = catalog();
    expect(subject.list('home')).toEqual([]);
    put('levels/new.yml', level('invaders-new'));
    expect(subject.list('home').map((l) => l.id)).toEqual(['invaders-new']);
  });
  it('requires a config service', () => { expect(() => new SkylineInvadersLevelCatalog()).toThrow(/configService/); });
});
