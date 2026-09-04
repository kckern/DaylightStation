import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlFoodCatalogDatastore } from './YamlFoodCatalogDatastore.mjs';
import { YamlMealTemplateDatastore } from './YamlMealTemplateDatastore.mjs';

describe('health collection persistence fails closed', () => {
  for (const Store of [YamlFoodCatalogDatastore, YamlMealTemplateDatastore]) {
    it(`${Store.name} distinguishes missing from corrupt YAML and never overwrites corruption`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-collection-'));
      const file = path.join(root, 'collection.yml');
      const store = new Store({ dataService: { user: { resolvePath: () => file } } });
      const read = () => store.getAll ? store.getAll('u') : store.list('u');
      expect(await read()).toEqual([]);
      fs.writeFileSync(file, '[ broken');
      await expect(read()).rejects.toThrow();
      await expect(store.save({ id: 'a', name: 'Food' }, 'u')).rejects.toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe('[ broken');
    });
  }
});
