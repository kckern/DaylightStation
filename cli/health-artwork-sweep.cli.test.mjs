import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { sweepHistory } from './health-artwork-sweep.cli.mjs';

describe('health-artwork-sweep', () => {
  it('dry run reports broken rows per food and what the ladder would pick, writing nothing', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-sweep-'));
    const nutrition = path.join(dataRoot, 'users/kc/lifelog/nutrition');
    fs.mkdirSync(path.join(nutrition, 'archives/nutrilist'), { recursive: true });
    const row = (uuid, name, date, over = {}) => ({ uuid, id: uuid, item: name, date, icon: 'default', version: 1, calories: 10, ...over });
    fs.writeFileSync(path.join(nutrition, 'nutrilist.yml'), yaml.dump([row('a', 'Apple Slices', '2026-09-22'), row('b', 'Oikos Pro Plain', '2026-09-21')]));
    fs.writeFileSync(path.join(nutrition, 'archives/nutrilist/2025-01.yml'), yaml.dump([row('c', 'Apple Slices', '2025-01-03'), row('d', 'Pear', '2025-01-04', { icon: 'pear' })]));
    const manifestPath = path.join(dataRoot, 'manifest.yml');
    fs.writeFileSync(manifestPath, yaml.dump({ icons: { apple: { path: 'img/nutrition/icons/apple.png' }, pear: { path: 'img/nutrition/icons/pear.png' } } }));
    const report = await sweepHistory({ dataRoot, userId: 'kc', manifestPath, now: Date.parse('2026-09-23T12:00:00Z') });
    expect(report).toMatchObject({ rowsScanned: 4, rowsWithBrokenArt: 3, foods: 2, enqueued: 0, foodsByResolution: { name: 1, 'stays-open': 1 } });
    expect(fs.existsSync(path.join(nutrition, 'artwork-queue.yml'))).toBe(false);
  });
});
