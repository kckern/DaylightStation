import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  PRESENTATION_CATALOG_MAP_FIELDS,
  materializePresentationCatalog,
  validatePresentationCatalog,
  validateTopDownScene,
} from '#shared/presentation/index.mjs';

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
    this.catalogCache = new Map(); this.assetIntegrityCache = new Map();
  }

  #stamp(file) {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }

  #dependenciesCurrent(dependencies) {
    try { return [...dependencies].every(([file, stamp]) => this.#stamp(file) === stamp); }
    catch { return false; }
  }

  #catalogFile(packId) {
    if (!PACK_ID.test(String(packId))) return null;
    const flat = path.join(this.catalogsDir, `${packId}.yml`);
    return fs.existsSync(flat) ? flat : path.join(this.catalogsDir, packId, 'catalog.yml');
  }

  #sceneIndex(packId) {
    const catalogFile = this.#catalogFile(packId);
    if (!catalogFile || !fs.existsSync(catalogFile)) return null;
    const packRoot = path.dirname(catalogFile); const indexFile = path.join(packRoot, 'scenes.yml');
    if (!indexFile.startsWith(`${this.catalogsDir}${path.sep}`) || !fs.existsSync(indexFile)) return null;
    const authored = YAML.parse(fs.readFileSync(indexFile, 'utf8'), { uniqueKeys: true }) ?? {};
    if (!Array.isArray(authored.scenes)) throw Object.assign(new Error(`invalid presentation scene index: ${indexFile}`), { status: 500, code: 'presentation_scene_index_invalid' });
    const ids = new Set(); const scenes = authored.scenes.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !PACK_ID.test(String(entry.id)) || typeof entry.manifest !== 'string' || !entry.manifest) {
        throw Object.assign(new Error(`invalid presentation scene descriptor at index ${index}`), { status: 500, code: 'presentation_scene_index_invalid' });
      }
      if (ids.has(entry.id)) throw Object.assign(new Error(`duplicate presentation scene id: ${entry.id}`), { status: 500, code: 'presentation_scene_index_invalid' });
      ids.add(entry.id);
      const file = path.resolve(packRoot, entry.manifest);
      if (!file.startsWith(`${packRoot}${path.sep}`) || !fs.existsSync(file)) throw Object.assign(new Error(`presentation scene manifest is unavailable: ${entry.id}`), { status: 500, code: 'presentation_scene_unavailable' });
      return { id: entry.id, theme: entry.theme ?? 'default', manifest: entry.manifest, file };
    });
    return { pack_id: packId, kind: authored.kind, schema_version: authored.schema_version, scenes };
  }

  #load(file, stack = [], dependencies = new Map()) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(`${this.catalogsDir}${path.sep}`)) throw new Error(`catalog import escapes catalog directory: ${file}`);
    if (stack.includes(resolved)) throw new Error(`catalog import cycle: ${[...stack, resolved].join(' -> ')}`);
    dependencies.set(resolved, this.#stamp(resolved));
    const authored = YAML.parse(fs.readFileSync(resolved, 'utf8'), { uniqueKeys: true }) ?? {}; const merged = {};
    if (!Array.isArray(authored.imports ?? [])) throw new Error(`${resolved}: imports must be an array`);
    for (const specifier of authored.imports ?? []) {
      if (typeof specifier !== 'string' || !specifier.trim() || path.isAbsolute(specifier)) throw new Error(`${resolved}: imports must be relative catalog paths`);
      const imported = this.#load(path.resolve(path.dirname(resolved), specifier), [...stack, resolved], dependencies);
      for (const field of PRESENTATION_CATALOG_MAP_FIELDS) mergeMap(merged, imported[field], field, specifier);
    }
    for (const [field, value] of Object.entries(authored)) if (field !== 'imports' && !PRESENTATION_CATALOG_MAP_FIELDS.includes(field)) merged[field] = value;
    for (const field of PRESENTATION_CATALOG_MAP_FIELDS) mergeMap(merged, authored[field], field, resolved);
    return merged;
  }

  get(packId) {
    const file = this.#catalogFile(packId);
    if (!file || !fs.existsSync(file)) return null;
    const cached = this.catalogCache.get(packId);
    if (cached?.file === file && this.#dependenciesCurrent(cached.dependencies)) return cached.catalog;
    const dependencies = new Map(); const catalog = materializePresentationCatalog(this.#load(file, [], dependencies)); const validation = validatePresentationCatalog(catalog);
    if (!validation.valid) throw Object.assign(new Error(`invalid presentation catalog: ${validation.errors.join('; ')}`), { status: 500, code: 'presentation_catalog_invalid' });
    this.catalogCache.set(packId, { file, dependencies, catalog });
    return catalog;
  }

  getAsset(packId, assetId) {
    const catalog = this.get(packId); const asset = catalog?.assets?.[assetId];
    if (asset?.status !== 'approved') return null;
    const file = path.resolve(this.assetRoot, asset.source);
    if (!file.startsWith(`${this.assetRoot}${path.sep}`) || !fs.existsSync(file)) throw Object.assign(new Error(`approved asset source is unavailable: ${assetId}`), { status: 500, code: 'asset_source_unavailable' });
    const stamp = this.#stamp(file); const integrity = this.assetIntegrityCache.get(file);
    if (integrity?.stamp !== stamp || integrity.sha256 !== asset.source_sha256) {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (sha256 !== asset.source_sha256) throw Object.assign(new Error(`approved asset hash mismatch: ${assetId}`), { status: 500, code: 'asset_hash_mismatch' });
      this.assetIntegrityCache.set(file, { stamp, sha256 });
    }
    return { id: assetId, ...asset, file };
  }

  listScenes(packId) {
    const index = this.#sceneIndex(packId);
    if (!index) return null;
    return { ...index, scenes: index.scenes.map(({ file, ...entry }) => entry) };
  }

  getScene(packId, sceneId) {
    if (!PACK_ID.test(String(sceneId))) return null;
    const index = this.#sceneIndex(packId); const descriptor = index?.scenes.find((entry) => entry.id === sceneId);
    if (!descriptor) return null;
    const scene = YAML.parse(fs.readFileSync(descriptor.file, 'utf8'), { uniqueKeys: true }) ?? {};
    if (scene.id !== descriptor.id) throw Object.assign(new Error(`presentation scene id mismatch: ${descriptor.id}`), { status: 500, code: 'presentation_scene_invalid' });
    const validation = validateTopDownScene(scene, this.get(packId));
    if (!validation.valid) throw Object.assign(new Error(`invalid presentation scene ${sceneId}: ${validation.errors.join('; ')}`), { status: 500, code: 'presentation_scene_invalid' });
    return scene;
  }
}
