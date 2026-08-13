import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { materializeAssetCatalog, resolveApprovedAsset, validateAssetCatalog } from '#shared/gaming/assets.mjs';

const PACK_ID = /^[a-z][a-z0-9-]{0,63}$/;
const CATALOG_MAP_FIELDS = ['license_scopes', 'asset_templates', 'assets', 'prefabs'];

function mergeCatalogMap(target, source, field, sourceFile) {
  if (source === undefined) return;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${sourceFile}: ${field} must be a map`);
  target[field] ??= {};
  for (const [id, value] of Object.entries(source)) {
    if (Object.hasOwn(target[field], id)) throw new Error(`${sourceFile}: duplicate imported ${field} id ${id}`);
    target[field][id] = value;
  }
}

export class YamlGamingAssetCatalog {
  constructor({ catalogsDir, assetRoot }) {
    this.catalogsDir = catalogsDir;
    this.assetRoot = path.resolve(assetRoot);
  }

  #catalogFile(packId) {
    if (!PACK_ID.test(String(packId))) return null;
    const flat = path.join(this.catalogsDir, `${packId}.yml`);
    return fs.existsSync(flat) ? flat : path.join(this.catalogsDir, packId, 'catalog.yml');
  }

  #loadCatalogFile(file, stack = []) {
    const resolved = path.resolve(file);
    const catalogRoot = path.resolve(this.catalogsDir);
    if (!resolved.startsWith(`${catalogRoot}${path.sep}`)) throw new Error(`catalog import escapes catalog directory: ${file}`);
    if (stack.includes(resolved)) throw new Error(`catalog import cycle: ${[...stack, resolved].join(' -> ')}`);
    const authored = YAML.parse(fs.readFileSync(resolved, 'utf8'), { uniqueKeys: true }) ?? {};
    const imports = authored.imports ?? [];
    if (!Array.isArray(imports) || imports.some((entry) => typeof entry !== 'string' || !entry.trim() || path.isAbsolute(entry))) throw new Error(`${resolved}: imports must be relative catalog paths`);
    const merged = {};
    for (const specifier of imports) {
      const imported = this.#loadCatalogFile(path.resolve(path.dirname(resolved), specifier), [...stack, resolved]);
      for (const field of CATALOG_MAP_FIELDS) mergeCatalogMap(merged, imported[field], field, specifier);
    }
    for (const [field, value] of Object.entries(authored)) if (field !== 'imports' && !CATALOG_MAP_FIELDS.includes(field)) merged[field] = value;
    for (const field of CATALOG_MAP_FIELDS) mergeCatalogMap(merged, authored[field], field, resolved);
    return merged;
  }

  get(packId) {
    const file = this.#catalogFile(packId);
    if (!file || !fs.existsSync(file)) return null;
    const catalog = this.#loadCatalogFile(file);
    const validation = validateAssetCatalog(catalog);
    if (!validation.valid) throw Object.assign(new Error(`invalid gaming asset catalog: ${validation.errors.join('; ')}`), { status: 500, code: 'asset_catalog_invalid' });
    return materializeAssetCatalog(catalog);
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
