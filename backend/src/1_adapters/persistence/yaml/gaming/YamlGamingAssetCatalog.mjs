import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { resolveApprovedAsset, validateAssetCatalog } from '#shared/gaming/assets.mjs';

const PACK_ID = /^[a-z][a-z0-9-]{0,63}$/;

export class YamlGamingAssetCatalog {
  constructor({ catalogsDir, assetRoot }) {
    this.catalogsDir = catalogsDir;
    this.assetRoot = path.resolve(assetRoot);
  }

  #catalogFile(packId) {
    return PACK_ID.test(String(packId)) ? path.join(this.catalogsDir, `${packId}.yml`) : null;
  }

  get(packId) {
    const file = this.#catalogFile(packId);
    if (!file || !fs.existsSync(file)) return null;
    const catalog = YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
    const validation = validateAssetCatalog(catalog);
    if (!validation.valid) throw Object.assign(new Error(`invalid gaming asset catalog: ${validation.errors.join('; ')}`), { status: 500, code: 'asset_catalog_invalid' });
    return catalog;
  }

  getAsset(packId, assetId) {
    const catalog = this.get(packId);
    if (!catalog) return null;
    const asset = resolveApprovedAsset(catalog, assetId);
    if (!asset) return null;
    const file = path.resolve(this.assetRoot, asset.source);
    if (!file.startsWith(`${this.assetRoot}${path.sep}`) || !fs.existsSync(file)) {
      throw Object.assign(new Error(`approved asset source is unavailable: ${assetId}`), { status: 500, code: 'asset_source_unavailable' });
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sha256 !== asset.source_sha256) throw Object.assign(new Error(`approved asset hash mismatch: ${assetId}`), { status: 500, code: 'asset_hash_mismatch' });
    return { ...asset, file };
  }
}
