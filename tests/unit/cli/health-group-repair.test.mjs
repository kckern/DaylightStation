import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { inspectGroupRepair, applyGroupRepair } from '../../../cli/health-group-repair.cli.mjs';
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'health-group-repair-'));
  const nutrition = path.join(directory, 'nutrition');
  fs.mkdirSync(nutrition);
  const items = [
    { id: 'taco000001', uuid: 'taco000001', label: 'Fish Taco', icon: 'tortilla', grams: 105, calories: 0 },
    { id: 'tortilla01', uuid: 'tortilla01', label: 'Tortilla', icon: 'tortilla', grams: 50, calories: 145 },
    { id: 'fish000001', uuid: 'fish000001', label: 'White Fish', icon: 'default', grams: 55, calories: 52 },
  ];
  fs.writeFileSync(path.join(nutrition, 'nutrilog.yml'), yaml.dump({ capture: { id: 'capture', status: 'accepted', items } }));
  fs.writeFileSync(path.join(nutrition, 'nutrilist.yml'), yaml.dump(items.map(item => ({ ...item, date: '2026-09-04', logId: 'capture' }))));
  return { directory, nutrition, selection: { logId: 'capture', label: 'Fish Taco', children: ['Tortilla', 'White Fish'], expectedCalories: 197 } };
}
describe('explicit dish repair', () => {
  it('backs up, restores hierarchy, and converges without changing nutrients', async () => {
    const f = fixture(), manifest = inspectGroupRepair(f.nutrition, f.selection);
    expect(manifest.updates).toHaveLength(3);
    const backup = path.join(f.directory, 'backup');
    await expect(applyGroupRepair(manifest, backup)).rejects.toThrow('offline');
    await applyGroupRepair(manifest, backup, { offline: true });
    const after = inspectGroupRepair(f.nutrition, f.selection);
    expect(after.updates).toEqual([]);
    expect(after.nutrientDigest).toBe(manifest.nutrientDigest);
    expect(after.capture.items[2]).toMatchObject({ parentId: 'taco000001', grams: 55, calories: 52 });
    expect(fs.existsSync(path.join(backup, 'nutrilog.yml'))).toBe(true);
  });
  it('refuses a changed source and does not infer a different grouping', async () => {
    const f = fixture(), manifest = inspectGroupRepair(f.nutrition, f.selection);
    expect(() => inspectGroupRepair(f.nutrition, { ...f.selection, children: ['Sauce'] })).toThrow('evidence');
    fs.appendFileSync(path.join(f.nutrition, 'nutrilog.yml'), '\n# source changed\n');
    await expect(applyGroupRepair(manifest, path.join(f.directory, 'backup'), { offline: true })).rejects.toThrow('Source changed');
  });
});
