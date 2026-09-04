import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveYamlToPathAtomic, loadYaml } from '#system/utils/FileIO.mjs';
import { planNutritionRepair } from './NutritionRepair.mjs';
import { inspectNutritionDirectory, applyNutritionRepair } from '../../../../cli/health-ledger-repair.cli.mjs';

const row = { uuid: 'a', date: '2020-01-01', name: 'Oats', calories: 200, protein: 5, carbs: 30, fat: 5, unit: 'cup', amount: 1 };
describe('evidence-only historical repair', () => {
  it('uses an exact unchanged capture snapshot, never volume or a changed portion', () => {
    const evidence = { ...row, grams: 80, originalQuantity: { grams: 80 } };
    expect(planNutritionRepair([row], [evidence]).updates[0].changes.grams).toBe(80);
    const changed = planNutritionRepair([{ ...row, calories: 400 }], [evidence]);
    expect(changed.updates[0].changes.grams).toBeNull();
    expect(changed.unresolved).toHaveLength(1);
    expect(planNutritionRepair([row], [evidence, { ...evidence, grams: 90, originalQuantity: { grams: 90 } }]).updates[0].changes.grams).toBeNull();
    expect(planNutritionRepair([row], [{ ...row, grams: 100 }]).updates[0].changes.grams).toBeNull();
  });

  it('rehearses a backed-up archive repair and converges without changing nutrition', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-rehearsal-'));
    const nutrition = path.join(root, 'nutrition');
    saveYamlToPathAtomic(path.join(nutrition, 'archives/nutrilist/2020-01.yml'), [row]);
    saveYamlToPathAtomic(path.join(nutrition, 'nutrilog.yml'), { capture: { items: [{ ...row, grams: 80, originalQuantity: { grams: 80 } }] } });
    const plan = inspectNutritionDirectory(nutrition);
    await expect(applyNutritionRepair(plan, path.join(root, 'blocked'))).rejects.toThrow('offline');
    const result = await applyNutritionRepair(plan, path.join(root, 'backup'), { offline: true });
    expect(result.changed).toBe(1);
    expect(loadYaml(path.join(root, 'backup/archives/nutrilist/2020-01'))[0]).toEqual(row);
    const repaired = loadYaml(path.join(nutrition, 'archives/nutrilist/2020-01'))[0];
    expect(repaired).toMatchObject({ grams: 80, calories: 200, protein: 5, carbs: 30, fat: 5, originalQuantity: { unit: 'cup', amount: 1 } });
    expect(inspectNutritionDirectory(nutrition).updates).toEqual([]);
  });

  it('refuses stale manifests before writing any backup or data', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-stale-'));
    const nutrition = path.join(root, 'nutrition');
    saveYamlToPathAtomic(path.join(nutrition, 'nutrilist.yml'), [row]);
    const plan = inspectNutritionDirectory(nutrition);
    saveYamlToPathAtomic(path.join(nutrition, 'nutrilist.yml'), [{ ...row, calories: 250 }]);
    await expect(applyNutritionRepair(plan, path.join(root, 'backup'), { offline: true })).rejects.toThrow('changed');
    expect(fs.existsSync(path.join(root, 'backup'))).toBe(false);
  });
});
