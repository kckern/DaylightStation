import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { mergeFoodNames, applyFoodNamesMerge } from './health-icon-manifest-merge.cli.mjs';

const installed = () => ({
  icons: { 'pita-bread': { path: 'img/nutrition/icons/bakery/pita-bread.png' }, cola: { path: 'img/nutrition/icons/drinks/cola.png' } },
  aliases: { pita_bread: { path: 'img/nutrition/icons/bakery/pita-bread.png' } },
  foodNames: { 'diet coke': 'cola' },
});

describe('mergeFoodNames', () => {
  it('adds an accepted slug and leaves icons and aliases untouched', () => {
    const before = installed();
    const { manifest, additions, changes } = mergeFoodNames(before, { 'pita bread': 'pita-bread', 'diet coke': 'cola' });
    expect(manifest.foodNames).toEqual({ 'diet coke': 'cola', 'pita bread': 'pita-bread' });
    expect(additions).toEqual([{ name: 'pita bread', slug: 'pita-bread' }]);
    expect(changes).toEqual([]);
    expect(manifest.icons).toEqual(installed().icons);
    expect(manifest.aliases).toEqual(installed().aliases);
    expect(before.foodNames).toEqual({ 'diet coke': 'cola' });
  });

  it('refuses a slug the manifest does not offer, naming it', () => {
    expect(() => mergeFoodNames(installed(), { 'feta cheese': 'feta-cubes' })).toThrow(/feta-cubes/);
  });

  it('refuses an alias target: only offered icons are food-name targets', () => {
    expect(() => mergeFoodNames(installed(), { pita: 'pita_bread' })).toThrow(/pita_bread/);
  });

  it('reports a reviewed value that replaces an installed one', () => {
    const m = installed();
    m.icons['diet-cola'] = { path: 'img/nutrition/icons/drinks/diet-cola.png' };
    const { changes } = mergeFoodNames(m, { 'diet coke': 'diet-cola' });
    expect(changes).toEqual([{ name: 'diet coke', from: 'cola', to: 'diet-cola' }]);
  });
});

describe('applyFoodNamesMerge', () => {
  it('backs up exclusively, writes, and verifies the icon and alias counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-merge-'));
    const manifestPath = path.join(dir, 'icon-manifest.yml');
    const backupPath = path.join(dir, 'backup.yml');
    fs.writeFileSync(manifestPath, yaml.dump(installed()));
    const out = applyFoodNamesMerge(manifestPath, { 'pita bread': 'pita-bread' }, backupPath);
    expect(out).toMatchObject({ added: 1, icons: 2, aliases: 1 });
    expect(yaml.load(fs.readFileSync(backupPath, 'utf8'))).toEqual(installed());
    expect(yaml.load(fs.readFileSync(manifestPath, 'utf8')).foodNames['pita bread']).toBe('pita-bread');
    // A second run never overwrites the earlier backup.
    expect(() => applyFoodNamesMerge(manifestPath, { 'pita bread': 'pita-bread' }, backupPath)).toThrow();
  });
});
