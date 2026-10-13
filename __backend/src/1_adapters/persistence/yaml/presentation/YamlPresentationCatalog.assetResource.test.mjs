import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlPresentationCatalog } from './YamlPresentationCatalog.mjs';

describe('YamlPresentationCatalog asset resources', () => {
  let root;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('returns verified asset bytes as an opaque resource without its local path', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-asset-resource-'));
    const assetRoot = path.join(root, 'assets');
    const file = path.join(assetRoot, 'hero.png');
    fs.mkdirSync(assetRoot, { recursive: true });
    const bytes = Buffer.from('png bytes');
    fs.writeFileSync(file, bytes);
    const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const catalog = new YamlPresentationCatalog({ catalogsDir: path.join(root, 'catalogs'), assetRoot });
    catalog.get = () => ({ assets: { hero: { status: 'approved', source: 'hero.png', source_sha256: sourceSha256 } } });

    const asset = catalog.getAsset('demo', 'hero');

    expect(asset).toMatchObject({ id: 'hero', sourceSha256 });
    expect(asset).not.toHaveProperty('file');
    expect(asset).not.toHaveProperty('source');
    expect(asset.resource).toMatchObject({ size: bytes.length, mimeType: 'image/png' });
    expect(asset.resource).not.toHaveProperty('path');
    expect(asset.resource).not.toHaveProperty('filePath');
  });
});
