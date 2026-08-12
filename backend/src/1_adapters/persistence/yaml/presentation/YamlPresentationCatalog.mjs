import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PRESENTATION_CATALOG_MAP_FIELDS, materializePresentationCatalog, validatePresentationCatalog } from '#shared/presentation/index.mjs';

const PACK_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function mergeMap(target, source, field, sourceFile) {
  if (source === undefined) return;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${sourceFile}: ${field} must be a map`);
  target[field] ??= {};
  for (const [id, value] of Object.entries(source)) {
    if (Object.hasOwn(target[field], id)) throw new Error(`${sourceFile}: duplicate imported ${field} id ${id}`);
    target[field][id] = value;
  }
}

export class YamlPresentationCatalog {
  constructor({ catalogsDir, assetRoot }) {
    this.catalogsDir = path.resolve(catalogsDir); this.assetRoot = path.resolve(assetRoot);
  }

  #catalogFile(packId) {
    if (!PACK_ID.test(String(packId))) return null;
    const flat = path.join(this.catalogsDir, `${packId}.yml`);
    return fs.existsSync(flat) ? flat : path.join(this.catalogsDir, packId, 'catalog.yml');
  }

  #load(file, stack = []) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(`${this.catalogsDir}${path.sep}`)) throw new Error(`catalog import escapes catalog directory: ${file}`);
    if (stack.includes(resolved)) throw new Error(`catalog import cycle: ${[...stack, resolved].join(' -> ')}`);
    const authored = YAML.parse(fs.readFileSync(resolved, 'utf8'), { uniqueKeys: true }) ?? {}; const merged = {};
    if (!Array.isArray(authored.imports ?? [])) throw new Error(`${resolved}: imports must be an array`);
    for (const specifier of authored.imports ?? []) {
      if (typeof specifier !== 'string' || !specifier.trim() || path.isAbsolute(specifier)) throw new Error(`${resolved}: imports must be relative catalog paths`);
      const imported = this.#load(path.resolve(path.dirname(resolved), specifier), [...stack, resolved]);
      for (const field of PRESENTATION_CATALOG_MAP_FIELDS) mergeMap(merged, imported[field], field, specifier);
    }
    for (const [field, value] of Object.entries(authored)) if (field !== 'imports' && !PRESENTATION_CATALOG_MAP_FIELDS.includes(field)) merged[field] = value;
    for (const field of PRESENTATION_CATALOG_MAP_FIELDS) mergeMap(merged, authored[field], field, resolved);
    return merged;
  }

  get(packId) {
    const file = this.#catalogFile(packId);
    if (!file || !fs.existsSync(file)) return null;
    const catalog = materializePresentationCatalog(this.#load(file)); const validation = validatePresentationCatalog(catalog);
    if (!validation.valid) throw Object.assign(new Error(`invalid presentation catalog: ${validation.errors.join('; ')}`), { status: 500, code: 'presentation_catalog_invalid' });
    return catalog;
  }

  getAsset(packId, assetId) {
    const catalog = this.get(packId); const asset = catalog?.assets?.[assetId];
    if (asset?.status !== 'approved') return null;
    const file = path.resolve(this.assetRoot, asset.source);
    if (!file.startsWith(`${this.assetRoot}${path.sep}`) || !fs.existsSync(file)) throw Object.assign(new Error(`approved asset source is unavailable: ${assetId}`), { status: 500, code: 'asset_source_unavailable' });
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sha256 !== asset.source_sha256) throw Object.assign(new Error(`approved asset hash mismatch: ${assetId}`), { status: 500, code: 'asset_hash_mismatch' });
    return { id: assetId, ...asset, file };
  }
}
