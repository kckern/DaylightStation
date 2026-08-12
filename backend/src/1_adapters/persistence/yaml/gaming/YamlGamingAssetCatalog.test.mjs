import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { YamlGamingAssetCatalog } from './YamlGamingAssetCatalog.mjs';

const roots = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('YamlGamingAssetCatalog imports', () => {
  it('composes relative catalogs and rejects duplicate or escaping IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-catalog-')); roots.push(root);
    const catalogsDir = path.join(root, 'catalog'); const assetRoot = path.join(root, 'media');
    await Promise.all([mkdir(catalogsDir), mkdir(assetRoot)]);
    const descriptor = { source: 'assets/example.png', status: 'candidate', license_scope: 'test' };
    await writeFile(path.join(catalogsDir, 'base.yml'), YAML.stringify({ schema_version: 1, pack: { id: 'base' }, assets: { 'asset.base': descriptor } }));
    await writeFile(path.join(catalogsDir, 'bundle.yml'), YAML.stringify({ schema_version: 1, pack: { id: 'bundle' }, imports: ['base.yml'], assets: { 'asset.local': descriptor } }));
    const catalog = new YamlGamingAssetCatalog({ catalogsDir, assetRoot });
    expect(Object.keys(catalog.get('bundle').assets).sort()).toEqual(['asset.base', 'asset.local']);

    await mkdir(path.join(catalogsDir, 'nested'));
    await writeFile(path.join(catalogsDir, 'nested', 'catalog.yml'), YAML.stringify({ schema_version: 1, pack: { id: 'nested' }, assets: { 'asset.nested': descriptor } }));
    expect(Object.keys(catalog.get('nested').assets)).toEqual(['asset.nested']);

    await writeFile(path.join(catalogsDir, 'bundle.yml'), YAML.stringify({ schema_version: 1, pack: { id: 'bundle' }, imports: ['base.yml'], assets: { 'asset.base': descriptor } }));
    expect(() => catalog.get('bundle')).toThrow(/duplicate imported assets id asset.base/);

    await writeFile(path.join(catalogsDir, 'bundle.yml'), YAML.stringify({ schema_version: 1, pack: { id: 'bundle' }, imports: ['../outside.yml'] }));
    expect(() => catalog.get('bundle')).toThrow(/catalog import escapes catalog directory/);
  });
});
