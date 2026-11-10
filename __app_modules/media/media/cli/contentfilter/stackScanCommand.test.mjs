import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { scanFilm, runStackScan, formatStackScan } from './stackScanCommand.mjs';

const zero = { pad: { in: 0, out: 0 }, minSec: 0 };
const profile = { categories: { sex_any: { effect: 'full-blur' } }, treatments: { 'full-blur': zero, blur: zero } };
const shown = (id, a, b, over = {}) => ({ id, type: 'skip', category: 'sex_any/sexually_suggestive', in: a, out: b, precision: 'frame', ...over });
const track = (a, b) => [{ in: a, grid: 6, cells: [8], box: { x: 0.3, y: 0.2, w: 0.3, h: 0.2 } }, { in: b, cells: [] }];
const edl = (cues) => ({ title: 'Fixture', timebase: { clock: 'vidangel' }, cues });
const override = { sync: { offsetSec: 0, scale: 1 } };

describe('scanFilm', () => {
  it('counts stacked groups without the guard and none with it', () => {
    const cues = [shown('a', 100, 110), shown('b', 103, 106, { regions: track(103, 106) }), shown('c', 300, 310), shown('d', 300, 310)];
    expect(scanFilm({ edl: edl(cues), profile, override })).toEqual({ before: 2, after: 0 });
  });
  it('is zero for a film with nothing stacked', () => {
    expect(scanFilm({ edl: edl([shown('a', 100, 110)]), profile, override })).toEqual({ before: 0, after: 0 });
  });
});

describe('runStackScan', () => {
  it('lists only refined films with stacking, ids and counts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'stack-'));
    const media = path.join(root, 'media'); const data = path.join(root, 'data');
    for (const d of ['edl', 'refined']) mkdirSync(path.join(media, d), { recursive: true });
    for (const d of ['profiles', 'overrides']) mkdirSync(path.join(data, d), { recursive: true });
    writeFileSync(path.join(data, 'profiles', 'family.yml'), yaml.dump(profile));
    const put = (rk, tag, cues) => {
      writeFileSync(path.join(media, 'edl', `${rk}.edl.yml`), yaml.dump({ title: 'x', sourceRef: { workId: Number(rk), tagSetId: tag }, timebase: { clock: 'vidangel' }, cues: [] }));
      writeFileSync(path.join(media, 'refined', `${rk}-${tag}.edl.yml`), yaml.dump(edl(cues)));
    };
    put('1001', 1, [shown('a', 100, 110), shown('b', 101, 105, { regions: track(101, 105) })]);
    put('1002', 2, [shown('a', 100, 110)]);
    writeFileSync(path.join(media, 'edl', '1003.edl.yml'), yaml.dump({ title: 'raw only', cues: [shown('a', 1, 2)] }));
    writeFileSync(path.join(data, 'overrides', '1001.yml'), yaml.dump(override));
    const r = runStackScan({ mediaFilterDir: media, dataFilterDir: data });
    expect(r).toMatchObject({ scanned: 2, stacked: 1, remaining: 0, films: [{ rk: '1001', before: 1, after: 0 }] });
    expect(formatStackScan(r)).toMatch(/1 of 2 refined films.*0 after\n {2}1001 {2}before 1 {2}after 0/);
  });
});
