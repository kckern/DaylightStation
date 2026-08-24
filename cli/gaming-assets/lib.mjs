import crypto from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { materializeAssetCatalog, resolveConnectorFrame, resolveHeightTransition, resolvePrefabLayers, resolveTerrainFrame, validateAssetCatalog, validatePrefabCatalog } from '../../shared/gaming/assets.mjs';
import { compileTopDownScene, PRESENTATION_CATALOG_MAP_FIELDS, resolveAssetAnimation, resolveLayeredAssetAnimation, resolveRiggedAssetAnimation, resolveRiggedAnimationState, validatePresentationCatalog } from '../../shared/presentation/scenes/index.mjs';

const IMAGE_EXTENSIONS = new Set(['.png']);
const PNG_SIGNATURE = '89504e470d0a1a0a';
const PNG_COLOR_MODES = new Map([
  [0, 'grayscale'], [2, 'rgb'], [3, 'indexed'], [4, 'grayscale-alpha'], [6, 'rgba'],
]);
const COMMON_CELLS = [8, 16, 24, 32, 48, 64];
const STATUS = new Set(['candidate', 'approved', 'deferred', 'rejected']);
const LICENSE_SCOPE_BY_PATH = [
  ['assets/free/', 'free-noncommercial'],
  ['assets/dungeons/', 'dungeons-commercial'],
  ['assets/volcano/', 'volcano-commercial'],
  ['assets/characters/', 'characters-commercial'],
  ['assets/desert/', 'desert-commercial'],
  ['assets/ui/', 'ui-commercial'],
  ['assets/halloween/', 'halloween-commercial'],
  ['assets/default/', 'core-commercial'],
  ['assets/quarantine/', 'private-use'],
  ['assets/side-scroller/', 'private-use'],
  ['Cute_Fantasy_Free/', 'free-noncommercial'],
  ['Cute_Fantasy_Dungeons/', 'dungeons-commercial'],
  ['Cute_Fantasy_Volcano/', 'volcano-commercial'],
  ['Cute_Fantasy_Characters/', 'characters-commercial'],
  ['Cute_Fantasy_Desert/', 'desert-commercial'],
  ['Cute_Fantasy_UI/', 'ui-commercial'],
  ['Cute_Fantasy_Halloween/', 'halloween-commercial'],
  ['Cute_Fantasy/', 'core-commercial'],
];

const PACK_ROOTS = new Map([
  ['Cute_Fantasy', 'default'], ['Cute_Fantasy_Characters', 'characters'],
  ['Cute_Fantasy_Desert', 'desert'], ['Cute_Fantasy_Dungeons', 'dungeons'],
  ['Cute_Fantasy_Free', 'free'], ['Cute_Fantasy_Halloween', 'halloween'],
  ['Cute_Fantasy_UI', 'ui'], ['Cute_Fantasy_Volcano', 'volcano'],
  ['Old_Sprites', 'quarantine'], ['Cute_Fantasy_MilitaryCamp', 'quarantine/military-camp'],
  ['Cute_Fantasy_ShroomLands', 'quarantine/shroom-lands'], ['Player_Aseprite_Files', 'quarantine/player-aseprite-files'],
]);

function posixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function resolveUnder(root, source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('source is required');
  const resolved = path.resolve(root, source);
  const safeRoot = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) throw new Error(`source escapes root: ${source}`);
  return resolved;
}

const CATALOG_MAP_FIELDS = [...PRESENTATION_CATALOG_MAP_FIELDS];

function mergeCatalogMap(target, source, field, sourceFile) {
  if (source === undefined) return;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${sourceFile}: ${field} must be a map`);
  target[field] ??= {};
  for (const [id, value] of Object.entries(source)) {
    if (Object.hasOwn(target[field], id)) throw new Error(`${sourceFile}: duplicate imported ${field} id ${id}`);
    target[field][id] = value;
  }
}

/** Load a catalog plus relative imports, rejecting cycles and ambiguous IDs. */
export async function loadAssetCatalog(catalogPath, { materialize = true } = {}) {
  const cache = new Map();
  const load = async (file, stack = []) => {
    const resolved = path.resolve(file);
    if (stack.includes(resolved)) throw new Error(`catalog import cycle: ${[...stack, resolved].join(' -> ')}`);
    if (cache.has(resolved)) return structuredClone(cache.get(resolved));
    const authored = YAML.parse(await readFile(resolved, 'utf8'), { uniqueKeys: true }) ?? {};
    const imports = authored.imports ?? [];
    if (!Array.isArray(imports) || imports.some((entry) => typeof entry !== 'string' || !entry.trim())) throw new Error(`${resolved}: imports must be relative catalog paths`);
    const merged = {};
    for (const specifier of imports) {
      if (path.isAbsolute(specifier)) throw new Error(`${resolved}: catalog import must be relative: ${specifier}`);
      const imported = await load(path.resolve(path.dirname(resolved), specifier), [...stack, resolved]);
      for (const field of CATALOG_MAP_FIELDS) mergeCatalogMap(merged, imported[field], field, specifier);
    }
    for (const [field, value] of Object.entries(authored)) if (field !== 'imports' && !CATALOG_MAP_FIELDS.includes(field)) merged[field] = value;
    for (const field of CATALOG_MAP_FIELDS) mergeCatalogMap(merged, authored[field], field, resolved);
    cache.set(resolved, structuredClone(merged));
    return merged;
  };
  const catalog = await load(catalogPath);
  return materialize ? materializeAssetCatalog(catalog) : catalog;
}

async function validateCatalogForQa({ root, catalogPath, catalog }) {
  return catalog?.schema_version === 2 ? validatePresentationCatalog(catalog) : validateManifest({ root, manifestPath: catalogPath });
}

function candidateCells(width, height) {
  return COMMON_CELLS
    .filter((size) => width % size === 0 && height % size === 0)
    .map((size) => [size, size]);
}

function licenseScope(source) {
  return LICENSE_SCOPE_BY_PATH.find(([prefix]) => source.includes(prefix))?.[1] ?? 'unknown';
}

function kebab(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function normalizedAssetPath(source, sourceDir, targetDir) {
  const relative = source.slice(`${sourceDir}/`.length).split('/');
  const root = relative.shift();
  if (!relative.length && IMAGE_EXTENSIONS.has(path.extname(root).toLowerCase())) {
    const extension = path.extname(root).toLowerCase();
    if (root.toLowerCase() === 'megaman-sprites.png') return [targetDir, 'side-scroller', 'players', 'megaman.png'].join('/');
    return [targetDir, 'quarantine', `${kebab(root.slice(0, -extension.length))}${extension}`].join('/');
  }
  const destinationRoot = PACK_ROOTS.get(root) ?? `quarantine/${kebab(root)}`;
  const defaultPrefixes = [
    [['Animals'], ['actors', 'animals']], [['Buildings', 'Buildings'], ['environment', 'buildings']],
    [['Crops'], ['environment', 'crops']], [['Enemies'], ['actors', 'enemies']],
    [['Icons'], ['ui', 'icons']], [['NPCs (Premade)'], ['actors', 'npcs', 'premade']],
    [['Outdoor decoration'], ['environment', 'props']], [['Player'], ['actors', 'player']],
    [['Tiles'], ['environment', 'tiles']], [['Trees'], ['environment', 'foliage']],
    [['Weather effects'], ['effects', 'weather']], [['Other'], ['quarantine', 'other']],
  ];
  const matchingPrefix = root === 'Cute_Fantasy'
    ? defaultPrefixes.find(([prefix]) => prefix.every((part, index) => relative[index] === part))
    : null;
  const sourceParts = matchingPrefix ? [...matchingPrefix[1], ...relative.slice(matchingPrefix[0].length)] : relative;
  const normalized = sourceParts.map((part) => {
    const extension = path.extname(part);
    return extension ? `${kebab(part.slice(0, -extension.length))}${extension.toLowerCase()}` : kebab(part);
  });
  return [targetDir, destinationRoot, ...normalized].join('/');
}

async function walk(directory) {
  // The raw vendor tree has hundreds of directories. A Promise.all recursive
  // traversal exhausts macOS's process-wide file table before image auditing
  // even begins, so walk one directory at a time.
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else files.push(child);
    }
  }
  return files;
}

async function imageFacts(file) {
  // Inventory must survive every file in a vendor dump. Native decoders can
  // terminate the process on a malformed PNG, so parse the fixed PNG header
  // here and reserve Canvas decoding for explicit preview commands.
  // Dropbox/cloud mounts and macOS's process-wide file table are fragile under
  // bulk inspection; keep these operations strictly one-at-a-time.
  const buffer = await readFile(file);
  const fileStat = await stat(file);
  if (buffer.length < 26 || buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('invalid PNG signature or IHDR');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  if (!width || !height) throw new Error('PNG has zero dimensions');
  return {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: fileStat.size,
    mime_type: 'image/png',
    modified_at: fileStat.mtime.toISOString(),
    image: {
      width,
      height,
      mode: PNG_COLOR_MODES.get(colorType) ?? `png-color-type-${colorType}`,
      has_alpha: colorType === 4 || colorType === 6 || buffer.includes(Buffer.from('tRNS')),
      candidate_cells: candidateCells(width, height),
    },
  };
}

function sourceRootFor(source, sourceDir) {
  const relative = source.slice(`${sourceDir}/`.length);
  return relative.split('/')[0] || null;
}

function nearestReadme(source, readmes) {
  const directory = path.posix.dirname(source);
  return readmes
    .filter((candidate) => directory === path.posix.dirname(candidate) || directory.startsWith(`${path.posix.dirname(candidate)}/`))
    .sort((a, b) => path.posix.dirname(b).length - path.posix.dirname(a).length)[0] ?? null;
}

function basicMime(extension) {
  return new Map([
    ['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.json', 'application/json'],
    ['.yml', 'application/yaml'], ['.yaml', 'application/yaml'], ['.py', 'text/x-python'],
    ['.aseprite', 'application/octet-stream'], ['.gif', 'image/gif'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ]).get(extension) ?? 'application/octet-stream';
}

export async function buildInventory({ root, sourceDir = 'sprites' }) {
  const sourceRoot = resolveUnder(root, sourceDir);
  const files = await walk(sourceRoot);
  const issues = [];
  const nonImages = [];
  const assets = [];
  const records = [];
  const readmes = files
    .map((file) => posixRelative(root, file))
    .filter((source) => /(?:^|\/)(?:read[ _-]?me|license)(?:\.[^/]*)?$/i.test(source));
  for (const file of files.sort()) {
    const ext = path.extname(file).toLowerCase();
    const source = posixRelative(root, file);
    if (source.split('/').some((part) => part.startsWith('.'))) {
      issues.push({ source, reason: 'hidden_path' });
      continue;
    }
    try {
      const buffer = await readFile(file);
      const fileStat = await stat(file);
      const isPng = buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === PNG_SIGNATURE;
      const common = {
        source,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        bytes: fileStat.size,
        mime_type: isPng ? 'image/png' : basicMime(ext),
        modified_at: fileStat.mtime.toISOString(),
        extension: ext || null,
        source_root: sourceRootFor(source, sourceDir),
        source_readme: nearestReadme(source, readmes),
        license_scope: licenseScope(source),
      };
      records.push(common);
      if (common.license_scope === 'unknown') issues.push({ source, reason: 'unresolved_provenance', source_root: common.source_root });
      if (!isPng) {
        nonImages.push(common);
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(ext)) issues.push({ source, reason: 'unexpected_image_extension', detected_mime: 'image/png' });
      const facts = await imageFacts(file);
      assets.push({ ...common, image: facts.image });
    } catch (error) {
      issues.push({ source, reason: IMAGE_EXTENSIONS.has(ext) ? 'unreadable_image' : 'unreadable_file', detail: error.message });
    }
  }
  const byHash = new Map();
  for (const asset of assets) byHash.set(asset.sha256, [...(byHash.get(asset.sha256) ?? []), asset.source]);
  const duplicates = [...byHash.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([sha256, sources]) => ({ sha256, sources }));
  return {
    schema_version: 1,
    generated_by: 'gaming-assets inventory',
    source_dir: sourceDir,
    summary: {
      files: records.length,
      images: assets.length,
      non_images: nonImages.length,
      issues: issues.length,
      duplicate_groups: duplicates.length,
      by_license_scope: Object.fromEntries(Object.entries(assets.reduce((counts, asset) => ({
        ...counts,
        [asset.license_scope]: (counts[asset.license_scope] ?? 0) + 1,
      }), {})).sort(([a], [b]) => a.localeCompare(b))),
    },
    files: records,
    assets,
    duplicates,
    issues,
    non_images: nonImages,
  };
}

/** Build a deterministic, non-destructive canonical-copy plan from a raw vendor tree. */
export async function buildOrganizationPlan({ root, sourceDir = 'sprites', targetDir = 'assets' }) {
  const sourceRoot = resolveUnder(root, sourceDir);
  const entries = (await walk(sourceRoot)).sort();
  const files = [];
  const byDestination = new Map();
  for (const file of entries) {
    const source = posixRelative(root, file);
    if (path.basename(file).startsWith('.') || !IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const destination = normalizedAssetPath(source, sourceDir, targetDir);
    const facts = await imageFacts(file);
    const item = { source, destination, source_sha256: facts.sha256, bytes: facts.bytes, license_scope: licenseScope(source) };
    files.push(item);
    byDestination.set(destination, [...(byDestination.get(destination) ?? []), source]);
  }
  const collisions = [...byDestination.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([destination, sources]) => ({ destination, sources }));
  return {
    schema_version: 1,
    generated_by: 'gaming-assets organize-plan',
    source_dir: sourceDir,
    target_dir: targetDir,
    operation: 'copy',
    summary: { files: files.length, collisions: collisions.length },
    files,
    collisions,
  };
}

/** Apply only an explicitly generated, collision-free copy plan. Raw source is never altered. */
export async function applyOrganizationPlan({ root, planPath }) {
  const plan = YAML.parse(await readFile(planPath, 'utf8')) ?? {};
  if (plan.schema_version !== 1 || plan.generated_by !== 'gaming-assets organize-plan' || plan.operation !== 'copy') throw new Error('not a gaming-assets copy plan');
  if (!Array.isArray(plan.files) || !plan.files.length) throw new Error('plan has no files');
  if (Array.isArray(plan.collisions) && plan.collisions.length) throw new Error('plan has destination collisions; resolve them before apply');
  let copied = 0; let unchanged = 0;
  for (const item of plan.files) {
    const source = resolveUnder(root, item.source);
    const destination = resolveUnder(root, item.destination);
    const sourceFacts = await imageFacts(source);
    if (!item.source_sha256 || sourceFacts.sha256 !== item.source_sha256) throw new Error(`source hash differs from reviewed plan: ${item.source}`);
    await ensureParent(destination);
    try {
      const destinationFacts = await imageFacts(destination);
      if (item.source_sha256 === destinationFacts.sha256) { unchanged += 1; continue; }
      throw new Error(`destination differs: ${item.destination}`);
    } catch (error) {
      if (!String(error.message).includes('ENOENT')) throw error;
    }
    await copyFile(source, destination);
    copied += 1;
  }
  return { copied, unchanged, files: plan.files.length, target_dir: plan.target_dir };
}

/** Prove every canonical copy still matches the reviewed raw source without writing files. */
export async function verifyOrganizationPlan({ root, planPath }) {
  const plan = YAML.parse(await readFile(planPath, 'utf8')) ?? {};
  if (plan.schema_version !== 1 || plan.generated_by !== 'gaming-assets organize-plan' || plan.operation !== 'copy') throw new Error('not a gaming-assets copy plan');
  if (!Array.isArray(plan.files) || !plan.files.length) throw new Error('plan has no files');
  const errors = [];
  let matched = 0;
  for (const item of plan.files) {
    let sourceFacts;
    try { sourceFacts = await imageFacts(resolveUnder(root, item.source)); } catch { errors.push({ source: item.source, reason: 'source_missing_or_unreadable' }); continue; }
    if (!item.source_sha256 || sourceFacts.sha256 !== item.source_sha256) { errors.push({ source: item.source, reason: 'source_hash_drift' }); continue; }
    let destinationFacts;
    try { destinationFacts = await imageFacts(resolveUnder(root, item.destination)); } catch { errors.push({ destination: item.destination, reason: 'destination_missing_or_unreadable' }); continue; }
    if (destinationFacts.sha256 !== item.source_sha256) { errors.push({ destination: item.destination, reason: 'destination_hash_mismatch' }); continue; }
    matched += 1;
  }
  return { valid: errors.length === 0, files: plan.files.length, matched, errors };
}

function validPair(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((part) => Number.isInteger(part) && part > 0);
}

function validCoordinate(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((part) => Number.isInteger(part) && part >= 0);
}

function validFrame(value, grid) {
  return Array.isArray(value) && value.length === 2
    && value.every((part) => Number.isInteger(part) && part >= 0)
    && value[0] < grid[0] && value[1] < grid[1];
}

function validId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value);
}

const TERRAIN_SWEEP_READINESS = new Set([
  'cataloged', 'metadata-only', 'derived-required', 'schema-required', 'partial', 'deferred', 'quarantined',
]);
const TERRAIN_SWEEP_TOPOLOGY = new Set([
  'cardinal-4', 'cardinal-4+diagonal-corners', 'cliff-height', 'connector-graph',
  'composite-atlas', 'border-kit',
]);
const TERRAIN_SWEEP_CORNER_SUPPORT = new Set([
  'raw', 'derived', 'missing', 'mixed', 'not-applicable',
]);

function terrainCapability(asset, topology) {
  if (['cardinal-4', 'cardinal-4+diagonal-corners', 'border-kit'].includes(topology)) return asset?.autotile ? 'autotile' : null;
  if (topology === 'cliff-height') return asset?.height ? 'height' : null;
  if (topology === 'connector-graph') return asset?.connector ? 'connector' : asset?.components ? 'components' : null;
  if (topology === 'composite-atlas') return asset?.autotile ? 'autotile' : asset?.components ? 'components' : null;
  return null;
}

function terrainCapabilities(asset) {
  return ['autotile', 'height', 'connector', 'components'].filter((capability) => asset?.[capability]);
}

function verifyTerrainEvidenceAsset({ asset, assetId, prefix, qaAssets, errors }) {
  if (!asset?.geometry || !asset?.frames || !Object.keys(asset.frames).length) {
    errors.push(`${prefix}: evidence asset lacks geometry or named frames: ${assetId}`);
    return;
  }
  const capabilities = terrainCapabilities(asset);
  if (!capabilities.length) errors.push(`${prefix}: evidence asset lacks reviewed topology metadata: ${assetId}`);
  for (const capability of capabilities) if (!qaAssets.get(capability)?.has(assetId)) errors.push(`${prefix}: evidence asset lacks passing ${capability} QA: ${assetId}`);
}

function verifyTerrainFamilyClaims({ assets, family, prefix, errors }) {
  if (!assets.some((asset) => terrainCapability(asset, family.topology))) errors.push(`${prefix}: no evidence asset implements ${family.topology}`);
  const required = new Set(family.required_metadata ?? []);
  if (required.has('polarity-map')) {
    if (!assets.some((asset) => Array.isArray(asset.autotile?.supported_polarities) && asset.autotile.supported_polarities.length)) errors.push(`${prefix}: polarity-map claim lacks supported_polarities`);
  }
  if (required.has('inner-corner-map') || required.has('compact-inner-corner-derivatives')) {
    if (!assets.some((asset) => asset.autotile?.inner_corners)) errors.push(`${prefix}: inside-corner claim lacks inner_corners`);
  }
  if (required.has('height-transitions') || required.has('cliff-height-map') || required.has('wall-height-map')) {
    if (!assets.some((asset) => asset.height?.transitions)) errors.push(`${prefix}: height claim lacks height.transitions`);
  }
  if (required.has('ports') || required.has('bridge-ports') || required.has('doorway-ports') || required.has('stair-ports')) {
    const hasPorts = assets.some((asset) => Object.values(asset.frames ?? {}).some((frame) => frame?.ports && Object.keys(frame.ports).length));
    if (!hasPorts) errors.push(`${prefix}: port claim lacks frame ports`);
  }
  if (required.has('stair-transition-map') || required.has('platform-transition-map')) {
    if (!assets.some((asset) => Object.values(asset.components ?? {}).some((component) => component?.transitions && Object.keys(component.transitions).length))) errors.push(`${prefix}: transition-map claim lacks component transitions`);
  }
  if (required.has('stair-direction-map')) {
    if (!assets.some((asset) => Object.values(asset.components ?? {}).some((component) => component?.directional_frames && Object.keys(component.directional_frames).length))) errors.push(`${prefix}: direction-map claim lacks component directional_frames`);
  }
  if (required.has('lava-border-map')) {
    if (!assets.some((asset) => Object.values(asset.components ?? {}).some((component) => component?.outline && component?.interior))) errors.push(`${prefix}: lava-border-map claim lacks outline and interior frames`);
  }
  if (family.topology === 'cardinal-4+diagonal-corners' && family.corner_support?.inner === 'missing') {
    errors.push(`${prefix}: cataloged diagonal topology cannot claim missing inside corners`);
  }
}

function globPattern(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { expression += '(?:.*/)?'; index += 2; }
      else { expression += '.*'; index += 1; }
    } else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

/**
 * Verify a curated terrain/topology sweep against the canonical asset tree.
 * This is deliberately separate from runtime catalog validation: a sweep can
 * record incomplete families without accidentally making them renderable.
 */
export async function auditTerrainMetadataSweep({ root, manifestPath }) {
  const errors = [];
  const warnings = [];
  let manifest;
  try { manifest = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {}; }
  catch (error) {
    return { valid: false, errors: [`cannot parse sweep: ${error.message}`], warnings, summary: {} };
  }
  if (manifest.schema_version !== 1) errors.push('schema_version must be 1');
  if (manifest.kind !== 'terrain-metadata-sweep') errors.push('kind must be terrain-metadata-sweep');
  if (!validPair(manifest.native_cell)) errors.push('native_cell must be a positive integer pair');
  const families = manifest.families;
  if (!families || typeof families !== 'object' || Array.isArray(families)) {
    return { valid: false, errors: [...errors, 'families must be an object'], warnings, summary: {} };
  }

  const qaAssets = new Map();
  const qaReports = manifest.qa_reports;
  const hasCatalogedFamilies = Object.values(families).some((family) => family?.readiness === 'cataloged');
  if (hasCatalogedFamilies && (!qaReports || typeof qaReports !== 'object' || Array.isArray(qaReports))) errors.push('qa_reports must map terrain capabilities to report paths');
  for (const capability of hasCatalogedFamilies ? ['autotile', 'height', 'connector', 'components'] : []) {
    const specifiers = Array.isArray(qaReports?.[capability]) ? qaReports[capability] : [qaReports?.[capability]].filter(Boolean);
    if (!specifiers.length) { errors.push(`qa_reports.${capability} must contain at least one report`); continue; }
    const ids = new Set();
    for (const specifier of specifiers) {
      if (typeof specifier !== 'string' || !specifier.trim()) { errors.push(`qa_reports.${capability} contains an invalid path`); continue; }
      const reportFile = path.resolve(path.dirname(manifestPath), specifier);
      try {
        const report = YAML.parse(await readFile(reportFile, 'utf8')) ?? {};
        if (report.valid !== true || !report.outputs || typeof report.outputs !== 'object' || Array.isArray(report.outputs)) errors.push(`qa report is not a passing output map: ${specifier}`);
        else for (const assetId of Object.keys(report.outputs)) ids.add(assetId);
      } catch (error) { errors.push(`cannot read qa report ${specifier}: ${error.message}`); }
    }
    qaAssets.set(capability, ids);
  }

  const ownedSources = new Map();
  const familyReports = [];
  const readinessCounts = {};
  const catalogCache = new Map();
  let measuredSources = 0;
  for (const [id, family] of Object.entries(families)) {
    const prefix = `family ${id}`;
    if (!validId(id)) errors.push(`${prefix}: invalid id`);
    if (!TERRAIN_SWEEP_READINESS.has(family?.readiness)) errors.push(`${prefix}: invalid readiness`);
    if (!TERRAIN_SWEEP_TOPOLOGY.has(family?.topology)) errors.push(`${prefix}: invalid topology`);
    for (const corner of ['outer', 'inner']) {
      if (!TERRAIN_SWEEP_CORNER_SUPPORT.has(family?.corner_support?.[corner])) errors.push(`${prefix}: corner_support.${corner} is invalid`);
    }
    if (!Array.isArray(family?.required_metadata) || !family.required_metadata.length) errors.push(`${prefix}: required_metadata must be a non-empty array`);
    if (!Array.isArray(family?.sources) || !family.sources.length) { errors.push(`${prefix}: sources must be a non-empty array`); continue; }
    const familyEvidenceAssets = [];
    if (family.readiness === 'cataloged') {
      const evidence = Array.isArray(family.catalog_evidence)
        ? family.catalog_evidence
        : [{ catalog: family.catalog, assets: family.catalog_assets }];
      if (!evidence.length || evidence.some((entry) => typeof entry?.catalog !== 'string' || !Array.isArray(entry?.assets) || !entry.assets.length)) errors.push(`${prefix}: cataloged families need catalog evidence`);
      else for (const evidenceEntry of evidence) {
        const catalogFile = path.resolve(path.dirname(manifestPath), evidenceEntry.catalog);
        let catalog = catalogCache.get(catalogFile);
        if (!catalog) {
          try {
            catalog = await loadAssetCatalog(catalogFile);
            catalogCache.set(catalogFile, catalog);
            const validation = catalog.schema_version === 2 ? validatePresentationCatalog(catalog) : validateAssetCatalog(catalog);
            if (!validation.valid) errors.push(...validation.errors.map((error) => `${prefix}: evidence catalog invalid: ${error}`));
          }
          catch (error) { errors.push(`${prefix}: cannot read evidence catalog: ${error.message}`); }
        }
        for (const assetId of evidenceEntry.assets) {
          const asset = catalog?.assets?.[assetId];
          if (asset?.status !== 'approved') errors.push(`${prefix}: evidence asset is not approved: ${assetId}`);
          else {
            const provenance = asset.derived_from ?? asset.source;
            if (!family.sources.some((source) => source.source === provenance)) errors.push(`${prefix}: evidence asset provenance is outside family sources: ${assetId}`);
            verifyTerrainEvidenceAsset({ asset, assetId, prefix, qaAssets, errors });
            familyEvidenceAssets.push(asset);
          }
        }
      }
      verifyTerrainFamilyClaims({ assets: familyEvidenceAssets, family, prefix, errors });
    }
    if (family.readiness === 'quarantined') {
      if (family.runtime_available !== false || typeof family.reason !== 'string' || !family.reason.trim() || typeof family.catalog !== 'string' || !Array.isArray(family.catalog_assets) || !family.catalog_assets.length) errors.push(`${prefix}: quarantined families need a reason, runtime_available false, and catalog evidence`);
      else {
        const catalogFile = path.resolve(path.dirname(manifestPath), family.catalog);
        let catalog;
        try { catalog = await loadAssetCatalog(catalogFile); }
        catch (error) { errors.push(`${prefix}: cannot read quarantine catalog: ${error.message}`); }
        for (const assetId of family.catalog_assets) {
          const asset = catalog?.assets?.[assetId];
          if (asset?.status !== 'deferred') errors.push(`${prefix}: quarantine asset must remain deferred: ${assetId}`);
          else {
            if (!asset.geometry || !asset.frames || !Object.keys(asset.frames).length) errors.push(`${prefix}: quarantined asset still needs reviewed geometry and named frames: ${assetId}`);
            const provenance = asset.derived_from ?? asset.source;
            if (!family.sources.some((source) => source.source === provenance)) errors.push(`${prefix}: quarantine asset provenance is outside family sources: ${assetId}`);
          }
        }
      }
    }
    readinessCounts[family.readiness] = (readinessCounts[family.readiness] ?? 0) + 1;
    let familyMeasured = 0;
    for (const descriptor of family.sources) {
      const source = descriptor?.source;
      if (typeof source !== 'string' || !source.startsWith('assets/')) { errors.push(`${prefix}: source must be beneath assets/`); continue; }
      if (ownedSources.has(source)) errors.push(`${prefix}: source is already assigned to ${ownedSources.get(source)}: ${source}`);
      else ownedSources.set(source, id);
      let facts;
      try { facts = await imageFacts(resolveUnder(root, source)); }
      catch { errors.push(`${prefix}: source is missing or unreadable: ${source}`); continue; }
      measuredSources += 1; familyMeasured += 1;
      if (!validPair(descriptor.dimensions) || descriptor.dimensions[0] !== facts.image.width || descriptor.dimensions[1] !== facts.image.height) {
        errors.push(`${prefix}: dimensions do not match ${facts.image.width}x${facts.image.height}: ${source}`);
      }
      if (descriptor.source_sha256 && descriptor.source_sha256 !== facts.sha256) errors.push(`${prefix}: source_sha256 does not match: ${source}`);
      if (descriptor.grid !== undefined) {
        if (!validPair(descriptor.grid)) errors.push(`${prefix}: grid must be a positive integer pair: ${source}`);
        else if (descriptor.grid[0] * manifest.native_cell[0] !== facts.image.width || descriptor.grid[1] * manifest.native_cell[1] !== facts.image.height) {
          errors.push(`${prefix}: 16px grid does not cover source dimensions: ${source}`);
        }
      }
    }
    familyReports.push({ id, readiness: family.readiness, topology: family.topology, sources: familyMeasured });
  }

  const coverage = manifest.coverage ?? {};
  const include = Array.isArray(coverage.include) ? coverage.include.map(globPattern) : [];
  const exclude = Array.isArray(coverage.exclude) ? coverage.exclude.map(globPattern) : [];
  const assetRoot = resolveUnder(root, 'assets');
  const canonicalPngs = (await walk(assetRoot))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => posixRelative(root, file))
    .sort();
  const inCoverage = canonicalPngs.filter((source) => include.some((pattern) => pattern.test(source)));
  const classifiedInCoverage = inCoverage.filter((source) => ownedSources.has(source));
  const excluded = inCoverage.filter((source) => !ownedSources.has(source) && exclude.some((pattern) => pattern.test(source)));
  const unreviewed = inCoverage.filter((source) => !ownedSources.has(source) && !exclude.some((pattern) => pattern.test(source)));
  if (!include.length) errors.push('coverage.include must contain at least one glob');
  if (unreviewed.length) errors.push(`coverage has ${unreviewed.length} unreviewed PNG source(s)`);

  return {
    valid: errors.length === 0,
    summary: {
      canonical_pngs: canonicalPngs.length,
      coverage_pngs: inCoverage.length,
      classified_sources: measuredSources,
      classified_in_coverage: classifiedInCoverage.length,
      classified_off_tree: measuredSources - classifiedInCoverage.length,
      excluded_non_topology: excluded.length,
      unreviewed_sources: unreviewed.length,
      families: familyReports.length,
      by_readiness: Object.fromEntries(Object.entries(readinessCounts).sort(([a], [b]) => a.localeCompare(b))),
    },
    families: familyReports,
    unreviewed,
    errors,
    warnings,
  };
}

/**
 * Prove that every canonical PNG has current machine facts and an explicit
 * disposition, while separately reporting the smaller set with reviewed
 * semantic frame metadata. This deliberately does not pretend that a measured
 * but deferred sheet is runtime-ready.
 */
export async function auditAssetMetadataCoverage({ root, inventoryPath, catalogPath }) {
  const errors = [];
  let inventory;
  try { inventory = YAML.parse(await readFile(inventoryPath, 'utf8')) ?? {}; }
  catch (error) { return { valid: false, errors: [`cannot parse inventory: ${error.message}`] }; }
  if (inventory.schema_version !== 1 || inventory.generated_by !== 'gaming-assets inventory' || inventory.source_dir !== 'assets') {
    return {
      valid: false,
      errors: ['inventory must be a v1 gaming-assets inventory generated with --source assets'],
    };
  }
  const records = Array.isArray(inventory.assets) ? inventory.assets : [];
  const bySource = new Map(records.map((record) => [record.source, record]));
  if (bySource.size !== records.length) errors.push('inventory contains duplicate source records');

  let catalog;
  try { catalog = await loadAssetCatalog(catalogPath); }
  catch (error) { return { valid: false, errors: [...errors, `cannot parse catalog: ${error.message}`] }; }
  const catalogValidation = validatePresentationCatalog(catalog);
  if (!catalogValidation.valid) errors.push(...catalogValidation.errors.map((error) => `catalog: ${error}`));

  const direct = new Map(); const provenance = new Set();
  for (const [id, asset] of Object.entries(catalog.assets ?? {})) {
    if (typeof asset.source === 'string') {
      direct.set(asset.source, [...(direct.get(asset.source) ?? []), id]);
      const record = bySource.get(asset.source);
      if (!record) errors.push(`catalog asset ${id}: source is absent from inventory: ${asset.source}`);
      else {
        if (asset.source_sha256 !== record.sha256) errors.push(`catalog asset ${id}: source hash differs from inventory`);
        if (!Number.isInteger(asset.pixel_density)) errors.push(`catalog asset ${id}: pixel_density is required`);
        if (!asset.geometry || !asset.frames || !Object.keys(asset.frames).length || !asset.world) errors.push(`catalog asset ${id}: reviewed geometry, frames, and world metadata are required`);
      }
    }
    if (typeof asset.derived_from === 'string') provenance.add(asset.derived_from);
  }

  const current = (await walk(resolveUnder(root, 'assets')))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => posixRelative(root, file)).sort();
  const currentSet = new Set(current);
  const missingInventory = current.filter((source) => !bySource.has(source));
  const staleInventory = [...bySource.keys()].filter((source) => !currentSet.has(source));
  if (missingInventory.length) errors.push(`${missingInventory.length} canonical PNGs are absent from inventory`);
  if (staleInventory.length) errors.push(`${staleInventory.length} inventory PNGs no longer exist`);

  const dispositions = { runtime_reviewed: 0, derivation_provenance: 0, deferred_measured: 0 };
  const unresolved = []; const sources = [];
  for (const record of records) {
    let facts;
    try { facts = await imageFacts(resolveUnder(root, record.source)); }
    catch { unresolved.push({ source: record.source, reason: 'missing_or_unreadable' }); continue; }
    if (facts.sha256 !== record.sha256 || facts.image.width !== record.image?.width || facts.image.height !== record.image?.height) {
      unresolved.push({ source: record.source, reason: 'inventory_drift' }); continue;
    }
    if (!record.license_scope || record.license_scope === 'unknown') { unresolved.push({ source: record.source, reason: 'license_scope_unknown' }); continue; }
    const disposition = direct.has(record.source) ? 'runtime_reviewed' : provenance.has(record.source) ? 'derivation_provenance' : 'deferred_measured';
    dispositions[disposition] += 1;
    sources.push({
      source: record.source,
      sha256: record.sha256,
      dimensions: [record.image.width, record.image.height],
      mode: record.image.mode,
      has_alpha: record.image.has_alpha,
      license_scope: record.license_scope,
      disposition,
      ...(direct.has(record.source) ? { runtime_assets: [...direct.get(record.source)].sort() } : {}),
      ...(provenance.has(record.source) ? { derivation_source: true } : {}),
    });
  }
  if (unresolved.length) errors.push(`${unresolved.length} canonical PNGs lack current measured facts or provenance`);
  return {
    valid: errors.length === 0,
    canonical_pngs: current.length,
    measured_pngs: records.length,
    disposition_coverage: records.length ? (records.length - unresolved.length) / records.length : 0,
    semantic_source_coverage: records.length ? dispositions.runtime_reviewed / records.length : 0,
    dispositions,
    runtime_assets: Object.keys(catalog.assets ?? {}).length,
    runtime_unique_sources: direct.size,
    sources: sources.sort((left, right) => left.source.localeCompare(right.source)),
    unresolved,
    errors,
  };
}

function validAnchor(value) {
  return typeof value === 'string'
    ? new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']).has(value)
    : Array.isArray(value?.point) && validCoordinate(value.point);
}

function frameRect(asset, frame, facts, cellOffset = [0, 0]) {
  if (asset.geometry.layout === 'grid') {
    const [cellW, cellH] = asset.geometry.cell;
    const [column, row] = frame.cell.map((value, index) => value + cellOffset[index]);
    const margin = asset.geometry.margin ?? [0, 0];
    const spacing = asset.geometry.spacing ?? [0, 0];
    return [margin[0] + column * (cellW + spacing[0]), margin[1] + row * (cellH + spacing[1]), cellW, cellH];
  }
  return frame.rect;
}

function longestTrueRun(values) {
  let longest = 0; let current = 0;
  for (const value of values) { current = value ? current + 1 : 0; longest = Math.max(longest, current); }
  return longest;
}

/**
 * Detect likely frame geometry that cuts a sprite through an internal grid
 * seam. A two-pixel continuous alpha bridge is extremely unlikely between
 * independent animation cells, but is common when a 32px actor was
 * accidentally described as two 16px rows (or a 48px actor as two 24px rows).
 */
function gridSeamBleedFromPixels({ pixels, imageWidth, asset }) {
  if (asset.geometry?.layout !== 'grid') return [];
  const allowedAxes = new Set(asset.geometry.cross_cell_alpha?.allowed_axes ?? []);
  const [cellWidth, cellHeight] = asset.geometry.cell; const [columns, rows] = asset.geometry.grid;
  const margin = asset.geometry.margin ?? [0, 0]; const spacing = asset.geometry.spacing ?? [0, 0];
  if (spacing.some((value) => value > 0)) return [];
  const visible = (x, y) => pixels[(y * imageWidth + x) * 4 + 3] > 0;
  const findings = [];
  for (let row = 1; row < rows; row += 1) {
    const y = margin[1] + row * cellHeight;
    for (let column = 0; column < columns; column += 1) {
      const x = margin[0] + column * cellWidth;
      const run = longestTrueRun(Array.from({ length: cellWidth }, (_, offset) => visible(x + offset, y - 1) && visible(x + offset, y)));
      if (run >= 2 && !allowedAxes.has('horizontal')) findings.push({ axis: 'horizontal', between: [row - 1, row], lane: column, continuous_alpha: run });
    }
  }
  for (let column = 1; column < columns; column += 1) {
    const x = margin[0] + column * cellWidth;
    for (let row = 0; row < rows; row += 1) {
      const y = margin[1] + row * cellHeight;
      const run = longestTrueRun(Array.from({ length: cellHeight }, (_, offset) => visible(x - 1, y + offset) && visible(x, y + offset)));
      if (run >= 2 && !allowedAxes.has('vertical')) findings.push({ axis: 'vertical', between: [column - 1, column], lane: row, continuous_alpha: run });
    }
  }
  return findings;
}

function animationGridSeamBleed(image, asset, createCanvas) {
  const sample = createCanvas(image.width, image.height); const context = sample.getContext('2d'); context.drawImage(image, 0, 0);
  return gridSeamBleedFromPixels({ pixels: context.getImageData(0, 0, image.width, image.height).data, imageWidth: image.width, asset });
}

/**
 * Measure plausible grid geometries across every deferred sprite-like source.
 * This is a machine-fact gate only: a seam-free grid is a curation candidate,
 * never an automatically approved semantic frame map.
 */
export async function auditSpriteGeometrySweep({ root, coveragePath, out = null }) {
  const coverage = YAML.parse(await readFile(coveragePath, 'utf8')) ?? {};
  if (coverage.schema_version !== 1 || coverage.kind !== 'animation-metadata-coverage-report' || !Array.isArray(coverage.deferred_sources)) throw new Error('sprite geometry sweep requires an animation-metadata-coverage-report');
  const { createCanvas, loadImage } = await import('canvas');
  const sources = [];
  for (const entry of coverage.deferred_sources) {
    const file = resolveUnder(root, entry.source); const image = await loadImage(file);
    const sample = createCanvas(image.width, image.height); const context = sample.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const cellPairs = [];
    const spriteCells = [...COMMON_CELLS, 80, 96, 128];
    for (const width of spriteCells) for (const height of spriteCells) if (image.width % width === 0 && image.height % height === 0 && width / height >= 0.5 && width / height <= 2) cellPairs.push([width, height]);
    const candidates = cellPairs.map((cell) => {
      const asset = { geometry: { layout: 'grid', cell, grid: [image.width / cell[0], image.height / cell[1]] } };
      const seams = gridSeamBleedFromPixels({ pixels, imageWidth: image.width, asset });
      return { cell, grid: asset.geometry.grid, frames: asset.geometry.grid[0] * asset.geometry.grid[1], seam_findings: seams.length, seam_examples: seams.slice(0, 3) };
    }).sort((a, b) => a.seam_findings - b.seam_findings || a.frames - b.frames || a.cell[0] - b.cell[0]);
    const minimumSeams = candidates[0]?.seam_findings ?? null;
    const best = candidates.filter((candidate) => candidate.seam_findings === minimumSeams);
    sources.push({ source: entry.source, rule: entry.rule, dimensions: [image.width, image.height], minimum_seam_findings: minimumSeams, candidate_status: !candidates.length ? 'no-divisible-grid' : best.length === 1 ? 'single-best' : 'ambiguous', best, candidates });
  }
  const summary = {
    sources: sources.length,
    single_best: sources.filter((entry) => entry.candidate_status === 'single-best').length,
    ambiguous: sources.filter((entry) => entry.candidate_status === 'ambiguous').length,
    no_divisible_grid: sources.filter((entry) => entry.candidate_status === 'no-divisible-grid').length,
    seam_free: sources.filter((entry) => entry.minimum_seam_findings === 0).length,
  };
  const report = { schema_version: 1, kind: 'sprite-geometry-sweep-report', valid: summary.no_divisible_grid === 0, summary, sources };
  if (out) await writeYaml(out, report);
  return report;
}

/** Validate the authored, one-file catalog shape used during the audit phase. */
export async function validateManifest({ root, manifestPath }) {
  const errors = [];
  const warnings = [];
  let manifest;
  try {
    manifest = await loadAssetCatalog(manifestPath, { materialize: false });
  } catch (error) {
    return { valid: false, errors: [`cannot parse manifest: ${error.message}`], warnings, assets: 0 };
  }
  try { manifest = materializeAssetCatalog(manifest); }
  catch (error) { return { valid: false, errors: [error.message], warnings, assets: 0 }; }
  if (![1, 2].includes(manifest.schema_version)) errors.push('schema_version must be 1 or 2');
  if (!manifest.pack?.id || typeof manifest.pack.id !== 'string') errors.push('pack.id is required');
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    errors.push('assets must be an object');
    return { valid: false, errors, warnings, assets: 0 };
  }
  for (const [id, asset] of Object.entries(manifest.assets)) {
    const prefix = `asset ${id}`;
    if (!validId(id)) errors.push(`${prefix}: invalid id`);
    if (!STATUS.has(asset?.status)) errors.push(`${prefix}: status must be candidate, approved, deferred, or rejected`);
    if (!asset?.license_scope || typeof asset.license_scope !== 'string') errors.push(`${prefix}: license_scope is required`);
    let file;
    try { file = resolveUnder(root, asset?.source); } catch (error) { errors.push(`${prefix}: ${error.message}`); continue; }
    let facts;
    try { facts = await imageFacts(file); } catch { errors.push(`${prefix}: source is missing or unreadable: ${asset.source}`); continue; }
    if (asset.source_sha256 && asset.source_sha256 !== facts.sha256) errors.push(`${prefix}: source_sha256 does not match source`);
    if (!asset.source_sha256) warnings.push(`${prefix}: source_sha256 is missing`);
    if (asset.status !== 'approved') continue;
    if (asset.license_scope === 'unknown') errors.push(`${prefix}: approved asset cannot use unknown license_scope`);
    if (!Array.isArray(asset.tags) || !asset.tags.length || asset.tags.some((tag) => !validId(tag))) errors.push(`${prefix}: approved asset needs valid tags`);
    if (!['image', 'sprite-sheet', 'tile-sheet', 'ui-sheet', 'effect-sheet'].includes(asset.kind)) errors.push(`${prefix}: approved asset needs a supported kind`);
    if (asset.pixel_density !== undefined && (!Number.isInteger(asset.pixel_density) || asset.pixel_density < 1 || asset.pixel_density > 8)) errors.push(`${prefix}: pixel_density must be an integer from 1 to 8`);
    if (asset.requires_all_ports !== undefined && typeof asset.requires_all_ports !== 'boolean') errors.push(`${prefix}: requires_all_ports must be boolean`);
    const geometry = asset.geometry;
    if (!geometry || !['grid', 'freeform'].includes(geometry.layout)) { errors.push(`${prefix}: approved asset needs geometry.layout grid or freeform`); continue; }
    let grid;
    if (geometry.layout === 'grid') {
      if (!validPair(geometry.cell) || !validPair(geometry.grid)) { errors.push(`${prefix}: grid geometry needs cell and grid`); continue; }
      const margin = geometry.margin ?? [0, 0]; const spacing = geometry.spacing ?? [0, 0];
      if (!validCoordinate(margin) || !validCoordinate(spacing)) errors.push(`${prefix}: grid margin and spacing must be non-negative pairs`);
      const [cellW, cellH] = geometry.cell; const [columns, rows] = geometry.grid;
      if (Number.isInteger(asset.pixel_density) && geometry.cell.some((value) => value % asset.pixel_density !== 0)) errors.push(`${prefix}: grid cell must be divisible by pixel_density`);
      if (geometry.cross_cell_alpha !== undefined && (!geometry.cross_cell_alpha || typeof geometry.cross_cell_alpha !== 'object' || Array.isArray(geometry.cross_cell_alpha) || !Array.isArray(geometry.cross_cell_alpha.allowed_axes) || !geometry.cross_cell_alpha.allowed_axes.length || geometry.cross_cell_alpha.allowed_axes.some((axis) => !['horizontal', 'vertical'].includes(axis)) || !String(geometry.cross_cell_alpha.reason ?? '').trim())) errors.push(`${prefix}: geometry.cross_cell_alpha needs allowed_axes and a review reason`);
      const requiredWidth = margin[0] * 2 + cellW * columns + spacing[0] * (columns - 1);
      const requiredHeight = margin[1] * 2 + cellH * rows + spacing[1] * (rows - 1);
      if (requiredWidth > facts.image.width || requiredHeight > facts.image.height || (!geometry.allow_trailing_padding && (requiredWidth !== facts.image.width || requiredHeight !== facts.image.height))) errors.push(`${prefix}: grid geometry does not match ${facts.image.width}x${facts.image.height} source`);
      grid = [columns, rows];
    }
    if (asset.defaults?.anchor && !validAnchor(asset.defaults.anchor)) errors.push(`${prefix}: invalid default anchor`);
    const forbiddenColors = asset.forbidden_colors ?? [];
    if (!Array.isArray(forbiddenColors) || forbiddenColors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) errors.push(`${prefix}: forbidden_colors must contain #rrggbb values`);
    const forbiddenRgb = new Set(forbiddenColors.map((color) => color.slice(1).toLowerCase()));
    const frames = asset.frames;
    if (!frames || typeof frames !== 'object' || Array.isArray(frames) || !Object.keys(frames).length) { errors.push(`${prefix}: approved asset needs named frames`); continue; }
    let decodedImage = null;
    for (const [frameName, frame] of Object.entries(frames)) {
      if (!validId(frameName)) errors.push(`${prefix}: invalid frame id ${frameName}`);
      const hasCell = Array.isArray(frame?.cell); const hasRect = Array.isArray(frame?.rect);
      if (hasCell === hasRect) { errors.push(`${prefix}: frame ${frameName} needs exactly one of cell or rect`); continue; }
      if (hasCell && (geometry.layout !== 'grid' || !validFrame(frame.cell, grid))) errors.push(`${prefix}: frame ${frameName} has invalid grid cell`);
      if (hasRect && (geometry.layout !== 'freeform' || !Array.isArray(frame.rect) || frame.rect.length !== 4 || frame.rect.some((part) => !Number.isInteger(part) || part < 0) || frame.rect[2] < 1 || frame.rect[3] < 1 || frame.rect[0] + frame.rect[2] > facts.image.width || frame.rect[1] + frame.rect[3] > facts.image.height)) errors.push(`${prefix}: frame ${frameName} has invalid source rect`);
      if (hasRect && Number.isInteger(asset.pixel_density) && frame.rect.slice(2).some((value) => value % asset.pixel_density !== 0)) errors.push(`${prefix}: frame ${frameName} size must be divisible by pixel_density`);
      if (frame.scale_reference !== undefined && (!validId(frame.scale_reference) || !frames?.[frame.scale_reference] || frame.scale_reference === frameName)) errors.push(`${prefix}: frame ${frameName} scale_reference must name another frame`);
      if (frame?.anchor && !validAnchor(frame.anchor)) errors.push(`${prefix}: frame ${frameName} has invalid anchor`);
      if (frame?.transparent !== undefined && typeof frame.transparent !== 'boolean') errors.push(`${prefix}: frame ${frameName} transparent must be boolean`);
      if (frame?.transparent === true && frame.content_bounds !== undefined) errors.push(`${prefix}: transparent frame ${frameName} cannot declare content_bounds`);
      if (frame?.opaque_overlay !== undefined && typeof frame.opaque_overlay !== 'boolean') errors.push(`${prefix}: frame ${frameName} opaque_overlay must be boolean`);
      if (frame?.allow_edge_contact !== undefined && typeof frame.allow_edge_contact !== 'boolean') errors.push(`${prefix}: frame ${frameName} allow_edge_contact must be boolean`);
      if (frame?.edge_contact !== undefined && (!Array.isArray(frame.edge_contact?.allowed) || frame.edge_contact.allowed.some((side) => !['north', 'east', 'south', 'west'].includes(side)) || !String(frame.edge_contact?.reason ?? '').trim())) errors.push(`${prefix}: frame ${frameName} edge_contact needs allowed sides and reason`);
      const forbiddenColorExceptions = frame?.forbidden_color_exceptions;
      const exceptionColors = forbiddenColorExceptions?.allowed ?? [];
      const exceptionShapeValid = forbiddenColorExceptions === undefined || (
        forbiddenColorExceptions && typeof forbiddenColorExceptions === 'object' && !Array.isArray(forbiddenColorExceptions)
        && Array.isArray(exceptionColors) && exceptionColors.length
        && exceptionColors.every((color) => /^#[0-9a-f]{6}$/i.test(color))
        && String(forbiddenColorExceptions.reason ?? '').trim()
      );
      if (!exceptionShapeValid) errors.push(`${prefix}: frame ${frameName} forbidden_color_exceptions needs allowed #rrggbb values and a review reason`);
      const normalizedExceptionColors = new Set(exceptionColors.map((color) => color.slice(1).toLowerCase()));
      const exceptionOutsidePolicy = [...normalizedExceptionColors].filter((color) => !forbiddenRgb.has(color));
      if (exceptionOutsidePolicy.length) errors.push(`${prefix}: frame ${frameName} forbidden_color_exceptions must be a subset of asset forbidden_colors: ${exceptionOutsidePolicy.map((color) => `#${color}`).join(', ')}`);
      const frameShapeValid = (hasCell && geometry.layout === 'grid' && validFrame(frame.cell, grid))
        || (hasRect && geometry.layout === 'freeform' && frame.rect.length === 4 && frame.rect.every(Number.isInteger) && frame.rect[2] > 0 && frame.rect[3] > 0 && frame.rect[0] + frame.rect[2] <= facts.image.width && frame.rect[1] + frame.rect[3] <= facts.image.height);
      if (frameShapeValid && frame.anchor?.point) {
        const [, , frameWidth, frameHeight] = frameRect(asset, frame, facts);
        if (frame.anchor.point[0] > frameWidth || frame.anchor.point[1] > frameHeight) errors.push(`${prefix}: frame ${frameName} custom anchor exceeds frame bounds`);
      }
      if (frame.ports !== undefined) {
        if (!frameShapeValid || !frame.ports || typeof frame.ports !== 'object' || Array.isArray(frame.ports)) {
          errors.push(`${prefix}: frame ${frameName} ports must be a named point map`);
        } else {
          const [, , frameWidth, frameHeight] = frameRect(asset, frame, facts);
          for (const [portName, point] of Object.entries(frame.ports)) {
            if (!validId(portName) || !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isInteger(value)) || point[0] < 0 || point[1] < 0 || point[0] > frameWidth || point[1] > frameHeight) errors.push(`${prefix}: frame ${frameName} port ${portName} must be a named point inside or on the frame boundary`);
          }
        }
      }
      if (frame.content_bounds !== undefined) {
        const bounds = frame.content_bounds;
        if (!frameShapeValid || !Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isInteger(value) || value < 0) || bounds[2] < 1 || bounds[3] < 1) {
          errors.push(`${prefix}: frame ${frameName} has invalid content_bounds`);
        } else {
          const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
          if (bounds[0] + bounds[2] > sw || bounds[1] + bounds[3] > sh) errors.push(`${prefix}: frame ${frameName} content_bounds exceeds frame`);
          else {
            const { createCanvas, loadImage } = await import('canvas');
            decodedImage ??= await loadImage(file);
            const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d');
            sampleContext.drawImage(decodedImage, sx, sy, sw, sh, 0, 0, sw, sh);
            const pixels = sampleContext.getImageData(0, 0, sw, sh).data;
            let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
            for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) if (pixels[(y * sw + x) * 4 + 3]) {
              minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            }
            const derived = maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
            if (!derived || derived.some((value, index) => value !== bounds[index])) errors.push(`${prefix}: frame ${frameName} content_bounds does not match visible alpha (${derived?.join(', ') ?? 'empty'})`);
            if (derived && asset.edge_policy === 'isolated') {
              const contacts = [...(derived[1] === 0 ? ['north'] : []), ...(derived[0] + derived[2] === sw ? ['east'] : []), ...(derived[1] + derived[3] === sh ? ['south'] : []), ...(derived[0] === 0 ? ['west'] : [])];
              const allowed = frame.edge_contact?.allowed ?? [];
              const missing = contacts.filter((side) => !allowed.includes(side)); const extra = allowed.filter((side) => !contacts.includes(side));
              if (missing.length) errors.push(`${prefix}: frame ${frameName} has undocumented source-edge contact: ${missing.join(', ')}`);
              if (extra.length) errors.push(`${prefix}: frame ${frameName} declares absent source-edge contact: ${extra.join(', ')}`);
            }
          }
        }
      } else if (frame.transparent === true && frameShapeValid) {
        const { createCanvas, loadImage } = await import('canvas');
        decodedImage ??= await loadImage(file);
        const [sx, sy, sw, sh] = frameRect(asset, frame, facts); const sample = createCanvas(sw, sh); const context = sample.getContext('2d'); context.drawImage(decodedImage, sx, sy, sw, sh, 0, 0, sw, sh);
        const pixels = context.getImageData(0, 0, sw, sh).data;
        if (pixels.some((value, index) => index % 4 === 3 && value > 0)) errors.push(`${prefix}: frame ${frameName} declares transparent but contains visible alpha`);
        if (!asset.tags.includes('animation-layer')) errors.push(`${prefix}: transparent frame ${frameName} is only valid on animation-layer assets`);
      } else if (asset.tags.includes('actor')) warnings.push(`${prefix}: frame ${frameName} content_bounds is missing for actor scale review`);
      if (frame.subject_bounds !== undefined) {
        const bounds = frame.subject_bounds;
        if (!frameShapeValid || !Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isInteger(value) || value < 0) || bounds[2] < 1 || bounds[3] < 1) {
          errors.push(`${prefix}: frame ${frameName} has invalid subject_bounds`);
        } else {
          const [, , sw, sh] = frameRect(asset, frame, facts); const content = frame.content_bounds;
          if (bounds[0] + bounds[2] > sw || bounds[1] + bounds[3] > sh) errors.push(`${prefix}: frame ${frameName} subject_bounds exceeds frame`);
          if (!content || bounds[0] < content[0] || bounds[1] < content[1] || bounds[0] + bounds[2] > content[0] + content[2] || bounds[1] + bounds[3] > content[1] + content[3]) errors.push(`${prefix}: frame ${frameName} subject_bounds must be enclosed by content_bounds`);
        }
      }
      if (asset.tags.includes('ground-contact')) {
        const anchor = frame.anchor ?? asset.defaults?.anchor;
        if (!Array.isArray(frame.content_bounds) || !Array.isArray(anchor?.point)) {
          errors.push(`${prefix}: ground-contact frame ${frameName} needs content_bounds and a custom anchor point`);
        } else if (frame.ground_contact !== undefined && (!validCoordinate(frame.ground_contact?.point) || !String(frame.ground_contact?.reason ?? '').trim())) {
          errors.push(`${prefix}: ground-contact frame ${frameName} ground_contact needs a point and review reason`);
        } else if (frame.ground_contact?.point && frame.ground_contact.point.some((value, index) => value !== anchor.point[index])) {
          errors.push(`${prefix}: ground-contact frame ${frameName} ground_contact point must equal its custom anchor`);
        } else if (!frame.ground_contact && frame.content_bounds[1] + frame.content_bounds[3] !== anchor.point[1]) {
          errors.push(`${prefix}: ground-contact frame ${frameName} anchor must equal the visible-alpha bottom`);
        } else if (frameShapeValid) {
          const [, , frameWidth, frameHeight] = frameRect(asset, frame, facts);
          const [boundsX, boundsY, boundsWidth, boundsHeight] = frame.content_bounds;
          const contacts = [...(boundsY === 0 ? ['north'] : []), ...(boundsX + boundsWidth === frameWidth ? ['east'] : []), ...(boundsY + boundsHeight === frameHeight ? ['south'] : []), ...(boundsX === 0 ? ['west'] : [])];
          const documented = contacts.every((side) => frame.edge_contact?.allowed?.includes(side));
          if (contacts.length && !documented) errors.push(`${prefix}: ground-contact frame ${frameName} visible alpha must be enclosed by transparent frame padding or explicitly document every measured source-edge contact`);
        }
      }
      if (frameShapeValid && asset.tags.includes('overlay')) {
        const { createCanvas, loadImage } = await import('canvas');
        decodedImage ??= await loadImage(file);
        const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
        const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d');
        sampleContext.drawImage(decodedImage, sx, sy, sw, sh, 0, 0, sw, sh);
        const pixels = sampleContext.getImageData(0, 0, sw, sh).data;
        let hasTransparency = false; let hasVisiblePixel = false;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) hasTransparency = true;
          if (pixels[index] > 0) hasVisiblePixel = true;
        }
        if (!hasVisiblePixel) errors.push(`${prefix}: overlay frame ${frameName} is empty`);
        if (!hasTransparency && frame.opaque_overlay !== true) errors.push(`${prefix}: overlay frame ${frameName} must contain transparency or explicitly set opaque_overlay`);
      }
      if (frameShapeValid && forbiddenRgb.size) {
        const { createCanvas, loadImage } = await import('canvas');
        decodedImage ??= await loadImage(file);
        const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
        const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d');
        sampleContext.drawImage(decodedImage, sx, sy, sw, sh, 0, 0, sw, sh);
        const pixels = sampleContext.getImageData(0, 0, sw, sh).data;
        const found = new Set();
        for (let index = 0; index < pixels.length; index += 4) {
          if (!pixels[index + 3]) continue;
          const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
          if (forbiddenRgb.has(rgb)) found.add(rgb);
        }
        const unreviewed = [...found].filter((color) => !normalizedExceptionColors.has(color));
        const stale = [...normalizedExceptionColors].filter((color) => !found.has(color));
        if (unreviewed.length) errors.push(`${prefix}: frame ${frameName} contains forbidden color ${unreviewed.map((color) => `#${color}`).join(', ')}`);
        if (stale.length) errors.push(`${prefix}: frame ${frameName} declares absent forbidden-color exception: ${stale.map((color) => `#${color}`).join(', ')}`);
      }
    }
    if (asset.animation?.mode === 'state-machine' && geometry.layout === 'grid') {
      const { createCanvas, loadImage } = await import('canvas');
      decodedImage ??= await loadImage(file);
      const seamBleed = animationGridSeamBleed(decodedImage, asset, createCanvas);
      if (seamBleed.length) {
        const sample = seamBleed.slice(0, 4).map((entry) => `${entry.axis} ${entry.between.join('/')} lane ${entry.lane} (${entry.continuous_alpha}px)`).join(', ');
        errors.push(`${prefix}: animation grid has continuous alpha across internal cell seams; cell geometry likely splits frames: ${sample}${seamBleed.length > 4 ? `, +${seamBleed.length - 4} more` : ''}`);
      }
    }
    if (asset.animation?.mode === 'state-machine') for (const [clipName, clip] of Object.entries(asset.clips ?? {})) {
      for (const entry of clip?.frames ?? []) {
        const frameName = typeof entry === 'string' ? entry : entry?.frame;
        if (frames?.[frameName] && !Array.isArray(frames[frameName].content_bounds) && frames[frameName].transparent !== true) errors.push(`${prefix}: animated frame ${frameName} in clip ${clipName} needs decoded content_bounds or reviewed transparent: true`);
      }
    }
    for (const [clipName, clip] of Object.entries(asset.clips ?? {})) {
      if (!validId(clipName) || !Array.isArray(clip?.frames) || !clip.frames.length) { errors.push(`${prefix}: clip ${clipName} needs named frames`); continue; }
      const timed = clip.frames.some((frame) => typeof frame === 'object');
      if (timed && clip.frames.some((frame) => typeof frame !== 'object' || !validId(frame.frame) || !Number.isInteger(frame.duration_ms) || frame.duration_ms < 1)) errors.push(`${prefix}: clip ${clipName} has invalid timed frame`);
      if (!timed && clip.frames.some((frame) => !validId(frame) || !frames[frame])) errors.push(`${prefix}: clip ${clipName} references unknown frame`);
      if (timed && clip.frames.some((frame) => !frames[frame.frame])) errors.push(`${prefix}: clip ${clipName} references unknown frame`);
      if (timed && clip.fps !== undefined) errors.push(`${prefix}: clip ${clipName} cannot mix fps and duration_ms`);
      if (!timed && (!Number.isFinite(clip.fps) || clip.fps <= 0)) errors.push(`${prefix}: clip ${clipName} needs positive fps`);
      if (clip.loop !== undefined && !['loop', 'once', 'ping-pong'].includes(clip.loop)) errors.push(`${prefix}: clip ${clipName} has invalid loop mode`);
    }
    if (asset.autotile !== undefined) {
      if (asset.kind !== 'tile-sheet') errors.push(`${prefix}: autotile requires a tile-sheet`);
      const mappings = asset.autotile?.positive || asset.autotile?.negative
        ? { positive: asset.autotile?.positive, negative: asset.autotile?.negative }
        : { positive: asset.autotile?.frames };
      if (asset.autotile?.topology !== undefined && !['cardinal-4', 'cardinal-4+diagonal-corners'].includes(asset.autotile.topology)) errors.push(`${prefix}: autotile topology must be cardinal-4 or cardinal-4+diagonal-corners`);
      if (!mappings.positive || typeof mappings.positive !== 'object') errors.push(`${prefix}: autotile needs a positive frame map`);
      for (const [polarity, mapping] of Object.entries(mappings)) {
        if (mapping === undefined) continue;
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) { errors.push(`${prefix}: autotile ${polarity} must be a frame map`); continue; }
        for (const [mask, frameName] of Object.entries(mapping)) {
          if (!['fallback', 'isolated'].includes(mask) && !/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask)) errors.push(`${prefix}: autotile ${polarity} mask ${mask} is not canonical n/e/s/w order`);
          if (!validId(frameName) || !frames?.[frameName]) errors.push(`${prefix}: autotile ${polarity} mask ${mask} references unknown frame`);
        }
      }
      for (const [frameName, variants] of Object.entries(asset.autotile?.variations ?? {})) {
        if (!frames?.[frameName] || !Array.isArray(variants) || variants.length < 2) { errors.push(`${prefix}: autotile variation ${frameName} needs at least two variants for a named frame`); continue; }
        for (const variant of variants) {
          if (!variant || typeof variant !== 'object' || Array.isArray(variant) || (variant.frame !== undefined && !frames?.[variant.frame]) || (variant.flip_x !== undefined && typeof variant.flip_x !== 'boolean')) errors.push(`${prefix}: autotile variation ${frameName} is invalid`);
        }
      }
      if (asset.autotile?.topology === 'cardinal-4+diagonal-corners') {
        const innerCorners = asset.autotile.inner_corners;
        if (!innerCorners || typeof innerCorners !== 'object' || Array.isArray(innerCorners)) errors.push(`${prefix}: diagonal-corner autotile needs an inner_corners frame map`);
        const mode = asset.autotile.inner_corner_mode ?? 'replace';
        if (!['replace', 'composite'].includes(mode)) errors.push(`${prefix}: inner_corner_mode must be replace or composite`);
        const maps = innerCorners && (innerCorners.positive || innerCorners.negative)
          ? Object.entries({ positive: innerCorners.positive, negative: innerCorners.negative }).filter(([, map]) => map !== undefined)
          : [['shared', innerCorners]];
        for (const [polarity, map] of maps) {
          if (!map || typeof map !== 'object' || Array.isArray(map)) { errors.push(`${prefix}: inside-corner ${polarity} map is invalid`); continue; }
          for (const [key, frameName] of Object.entries(map)) {
            if (!/^(?:nw|ne|se|sw)(?:-(?:nw|ne|se|sw))*$/.test(key)) errors.push(`${prefix}: inside-corner key ${key} is invalid`);
            if (mode === 'composite' && key.includes('-')) errors.push(`${prefix}: composite inside-corner maps use single corner keys, not ${key}`);
            if (!validId(frameName) || !frames?.[frameName]) errors.push(`${prefix}: inside-corner key ${key} references unknown frame`);
          }
        }
      }
      if (asset.autotile?.animation !== undefined) {
        const animation = asset.autotile.animation;
        if (animation?.mode !== 'grid-offset') errors.push(`${prefix}: autotile animation mode must be grid-offset`);
        if (!Number.isInteger(animation?.frames) || animation.frames < 2) errors.push(`${prefix}: autotile animation frames must be at least 2`);
        if (!Number.isFinite(animation?.fps) || animation.fps <= 0) errors.push(`${prefix}: autotile animation fps must be positive`);
        if (!validCoordinate(animation?.phase_stride) || animation.phase_stride.every((value) => value === 0)) errors.push(`${prefix}: autotile animation phase_stride must be a non-zero non-negative cell pair`);
        if (animation?.loop !== undefined && !['loop', 'once', 'ping-pong'].includes(animation.loop)) errors.push(`${prefix}: autotile animation loop is invalid`);
        if (asset.geometry.layout === 'grid' && validCoordinate(animation?.phase_stride) && Number.isInteger(animation?.frames)) {
          for (const [frameName, frame] of Object.entries(frames ?? {})) if (frame?.cell) {
            const lastCell = frame.cell.map((value, index) => value + animation.phase_stride[index] * (animation.frames - 1));
            if (lastCell[0] >= asset.geometry.grid[0] || lastCell[1] >= asset.geometry.grid[1]) errors.push(`${prefix}: animated frame ${frameName} phase range exceeds grid`);
          }
        }
      }
    }
    if (asset.connector !== undefined) {
      if (asset.connector?.topology !== 'connector-graph') errors.push(`${prefix}: connector topology must be connector-graph`);
      if (!asset.connector?.pieces || typeof asset.connector.pieces !== 'object' || Array.isArray(asset.connector.pieces)) errors.push(`${prefix}: connector needs a pieces map`);
      for (const [mask, descriptor] of Object.entries(asset.connector?.pieces ?? {})) {
        if (!['isolated'].includes(mask) && !/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask)) errors.push(`${prefix}: connector mask ${mask} is not canonical`);
        const frameName = typeof descriptor === 'string' ? descriptor : descriptor?.frame;
        if (!validId(frameName) || !frames?.[frameName]) errors.push(`${prefix}: connector mask ${mask} references unknown frame`);
        if (descriptor?.rotation !== undefined && ![0, 90, 180, 270].includes(descriptor.rotation)) errors.push(`${prefix}: connector mask ${mask} has invalid rotation`);
        const ports = { n: 'north', e: 'east', s: 'south', w: 'west' };
        for (const direction of mask === 'isolated' ? [] : mask.split('')) if (!frames?.[frameName]?.ports?.[ports[direction]]) errors.push(`${prefix}: connector mask ${mask} frame ${frameName} lacks ${ports[direction]} port`);
      }
    }
    if (asset.height !== undefined) {
      if (asset.height?.topology !== 'cliff-height') errors.push(`${prefix}: height topology must be cliff-height`);
      if (!Number.isInteger(asset.height?.rise_cells) || asset.height.rise_cells < 1) errors.push(`${prefix}: height rise_cells must be positive`);
      if (!asset.height?.bands || typeof asset.height.bands !== 'object' || Array.isArray(asset.height.bands)) errors.push(`${prefix}: height needs a bands map`);
      for (const [band, frameNames] of Object.entries(asset.height?.bands ?? {})) {
        if (!validId(band) || !Array.isArray(frameNames) || frameNames.length !== 3) errors.push(`${prefix}: height band ${band} must contain left/middle/right frames`);
        else for (const frameName of frameNames) if (!frames?.[frameName]) errors.push(`${prefix}: height band ${band} references unknown frame ${frameName}`);
      }
      if (!asset.height?.transitions || typeof asset.height.transitions !== 'object' || Array.isArray(asset.height.transitions)) errors.push(`${prefix}: height needs transitions`);
      for (const [direction, bands] of Object.entries(asset.height?.transitions ?? {})) {
        if (!['north', 'east', 'south', 'west'].includes(direction) || !Array.isArray(bands) || !bands.length) errors.push(`${prefix}: height transition ${direction} is invalid`);
        else for (const band of bands) if (!asset.height.bands?.[band]) errors.push(`${prefix}: height transition ${direction} references unknown band ${band}`);
      }
    }
    if (asset.components !== undefined) {
      if (!asset.components || typeof asset.components !== 'object' || Array.isArray(asset.components)) errors.push(`${prefix}: components must be a map`);
      for (const [componentId, component] of Object.entries(asset.components ?? {})) {
        if (!validId(componentId) || !['fill', 'border', 'stair', 'doorway', 'hazard', 'transition', 'decoration'].includes(component?.role) || !Array.isArray(component?.frames) || !component.frames.length) errors.push(`${prefix}: component ${componentId} is invalid`);
        else {
          for (const frameName of component.frames) if (!frames?.[frameName]) errors.push(`${prefix}: component ${componentId} references unknown frame ${frameName}`);
          if (component.outline !== undefined) {
            const keys = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
            if (!['border', 'hazard'].includes(component.role) || !component.outline || typeof component.outline !== 'object' || Array.isArray(component.outline) || keys.some((key) => !frames?.[component.outline[key]])) errors.push(`${prefix}: component ${componentId} outline must map nw/n/ne/w/e/sw/s/se to frames for a border or hazard`);
            if (component.interior !== undefined && !frames?.[component.interior]) errors.push(`${prefix}: component ${componentId} interior references unknown frame`);
          }
        }
      }
    }
  }
  errors.push(...validatePrefabCatalog(manifest));
  if (manifest.schema_version === 2) errors.push(...validatePresentationCatalog(manifest).errors);
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors, warnings, assets: Object.keys(manifest.assets).length };
}

async function createPixelCanvas(width, height) {
  const { createCanvas } = await import('canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

async function ensureParent(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function sha256File(file) {
  return crypto.createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function writeYaml(file, value) {
  await ensureParent(file);
  await writeFile(file, YAML.stringify(value));
}

export async function renderContactSheet({ root, sourceDir = 'sprites', out, columns = 6, limit = Infinity, scale = 3, catalogPath = null }) {
  const sourceRoot = resolveUnder(root, sourceDir);
  const files = (await walk(sourceRoot))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .slice(0, limit);
  if (!files.length) throw new Error('no PNG files found');
  const catalog = catalogPath ? await loadAssetCatalog(catalogPath) : {};
  const reviewBySource = new Map(Object.entries(catalog.assets ?? {}).map(([id, asset]) => [asset.source, { id, status: asset.status ?? 'unreviewed' }]));
  const thumb = 96 * scale;
  const label = 48;
  const rows = Math.ceil(files.length / columns);
  const { createCanvas, loadImage } = await import('canvas');
  const { canvas, ctx } = await createPixelCanvas(columns * thumb, rows * (thumb + label));
  ctx.fillStyle = '#171923';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px sans-serif';
  const fittedText = (value, x, y, maxWidth, color) => {
    let text = String(value); let size = 11;
    while (size > 8 && ctx.measureText(text).width > maxWidth) { size -= 1; ctx.font = `${size}px sans-serif`; }
    while (text.length > 4 && ctx.measureText(text).width > maxWidth) text = `${text.slice(0, -2)}…`;
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.font = '11px sans-serif';
  };
  const byStatus = {};
  for (const [index, file] of files.entries()) {
    const image = await loadImage(file);
    const x = (index % columns) * thumb;
    const y = Math.floor(index / columns) * (thumb + label);
    const ratio = Math.min((thumb - 8) / image.width, (thumb - 8) / image.height);
    const width = Math.max(1, Math.floor(image.width * ratio));
    const height = Math.max(1, Math.floor(image.height * ratio));
    ctx.drawImage(image, x + Math.floor((thumb - width) / 2), y + Math.floor((thumb - height) / 2), width, height);
    const source = posixRelative(root, file);
    const review = reviewBySource.get(source) ?? { status: 'unreviewed' };
    byStatus[review.status] = (byStatus[review.status] ?? 0) + 1;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y + thumb, thumb, label); ctx.clip();
    const name = path.basename(file);
    fittedText(name, x + 4, y + thumb + 13, thumb - 8, '#ffffff');
    const cells = candidateCells(image.width, image.height).map(([cell]) => cell).join('/');
    fittedText(`${image.width}×${image.height} · cells ${cells || '—'}`, x + 4, y + thumb + 26, thumb - 8, '#aeb8c9');
    fittedText(`${review.status}${review.id ? ` · ${review.id}` : ''}`, x + 4, y + thumb + 40, thumb - 8, review.status === 'approved' ? '#8ce99a' : '#ffd43b');
    ctx.restore(); ctx.fillStyle = '#ffffff';
  }
  await ensureParent(out);
  await writeFile(out, canvas.toBuffer('image/png'));
  return { files: files.length, out, width: canvas.width, height: canvas.height, by_status: byStatus };
}

/** Render every cell in a sheet with coordinate labels for visual geometry review. */
export async function renderFrameGrid({ root, source, cell, out, scale = 4 }) {
  const file = resolveUnder(root, source);
  const { loadImage } = await import('canvas');
  const image = await loadImage(file);
  const [cellW, cellH] = cell;
  if (image.width % cellW || image.height % cellH) throw new Error(`cell ${cellW}x${cellH} does not evenly divide ${image.width}x${image.height}`);
  const [columns, rows] = [image.width / cellW, image.height / cellH];
  const label = 16; const gap = 4;
  const { canvas, ctx } = await createPixelCanvas(columns * (cellW * scale + gap), rows * (cellH * scale + label + gap));
  ctx.fillStyle = '#171923'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false; ctx.font = '11px sans-serif';
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = column * (cellW * scale + gap); const y = row * (cellH * scale + label + gap);
    ctx.drawImage(image, column * cellW, row * cellH, cellW, cellH, x, y, cellW * scale, cellH * scale);
    ctx.fillStyle = '#aeb8c9'; ctx.fillText(`${column},${row}`, x + 2, y + cellH * scale + 12); ctx.fillStyle = '#ffffff';
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, columns, rows, cell, width: canvas.width, height: canvas.height };
}

/** Measure the exact visible-alpha bounds of every cell in a regular sheet. */
export async function measureFrameGrid({ root, source, cell }) {
  const file = resolveUnder(root, source);
  const { createCanvas, loadImage } = await import('canvas');
  const image = await loadImage(file);
  const [cellW, cellH] = cell;
  if (image.width % cellW || image.height % cellH) throw new Error(`cell ${cellW}x${cellH} does not evenly divide ${image.width}x${image.height}`);
  const columns = image.width / cellW; const rows = image.height / cellH;
  const sample = createCanvas(cellW, cellH); const ctx = sample.getContext('2d');
  const frames = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    ctx.clearRect(0, 0, cellW, cellH);
    ctx.drawImage(image, column * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
    const pixels = ctx.getImageData(0, 0, cellW, cellH).data;
    let minX = cellW; let minY = cellH; let maxX = -1; let maxY = -1;
    for (let y = 0; y < cellH; y += 1) for (let x = 0; x < cellW; x += 1) if (pixels[(y * cellW + x) * 4 + 3]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const contentBounds = maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
    const edgeContact = contentBounds ? ['west', 'north', 'east', 'south'].filter((direction) => ({ west: minX === 0, north: minY === 0, east: maxX === cellW - 1, south: maxY === cellH - 1 })[direction]) : [];
    frames.push({ cell: [column, row], content_bounds: contentBounds, edge_contact: edgeContact });
  }
  return { source, dimensions: [image.width, image.height], cell, grid: [columns, rows], frames };
}

export function parsePair(value, name) {
  const match = /^(\d+)x(\d+)$/.exec(String(value));
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw new Error(`${name} must be WIDTHxHEIGHT`);
  return [Number(match[1]), Number(match[2])];
}

export function parseFrames(value) {
  const frames = String(value).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^(\d+),(\d+)$/.exec(part);
    if (!match) throw new Error('--frames must use x,y;x,y');
    return [Number(match[1]), Number(match[2])];
  });
  if (!frames.length) throw new Error('--frames requires at least one frame');
  return frames;
}

async function renderFrame({ file, cell, frame, scale }) {
  const { loadImage } = await import('canvas');
  const image = await loadImage(file);
  const [cellW, cellH] = cell;
  const [column, row] = frame;
  if ((column + 1) * cellW > image.width || (row + 1) * cellH > image.height) {
    throw new Error(`frame ${column},${row} exceeds ${image.width}x${image.height} sheet`);
  }
  const { canvas, ctx } = await createPixelCanvas(cellW * scale, cellH * scale);
  ctx.drawImage(image, column * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderAnimation({ root, source, cell, frames, out, fps = 8, scale = 4 }) {
  const file = resolveUnder(root, source);
  const { GifCodec, GifFrame, GifUtil } = await import('gifwrap');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('--fps must be positive');
  if (!Number.isInteger(scale) || scale < 1) throw new Error('--scale must be a positive integer');
  const rendered = await Promise.all(frames.map((frame) => renderFrame({ file, cell, frame, scale })));
  const delayCentisecs = Math.max(1, Math.round(100 / fps));
  // canvas.toBuffer('raw') is platform-native BGRA on macOS; GifFrame expects
  // RGBA. Read pixels through the Canvas API so visual regression GIFs are
  // faithful instead of valid-but-black files.
  const gifFrames = rendered.map((canvas) => new GifFrame(
    canvas.width,
    canvas.height,
    Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data),
    { delayCentisecs },
  ));
  // GIF palettes are limited to 256 indexes. Quantize the whole animation as
  // one series so frames share a stable palette and do not flicker.
  GifUtil.quantizeWu(gifFrames, 256, 5);
  const gif = await new GifCodec().encodeGif(gifFrames, { loops: 0 });
  await ensureParent(out);
  await writeFile(out, gif.buffer);
  return { frames: frames.length, fps, out, width: rendered[0].width, height: rendered[0].height };
}

const SPRITE_PATH_PATTERN = /\/(?:actors?|characters?|creatures?|enemies|npcs?|players?|items?|objects?|props?|effects?|vfx)(?:\/|$)/i;
const SPRITE_TAGS = new Set(['actor', 'player', 'npc', 'creature', 'enemy', 'item', 'prop', 'object', 'effect', 'animated']);

function isSpriteAsset(asset) {
  return ['sprite-sheet', 'effect-sheet', 'item-sheet'].includes(asset.kind)
    || (asset.tags ?? []).some((tag) => SPRITE_TAGS.has(tag));
}

async function runtimeSpriteSourceCoverage(root, runtimeAssets) {
  const { createCanvas, loadImage } = await import('canvas');
  const bySource = new Map();
  for (const entry of runtimeAssets) {
    const asset = entry.asset;
    const signature = asset.geometry?.layout === 'grid'
      ? `grid:${asset.geometry.cell?.join('x')}:${asset.geometry.grid?.join('x')}:${(asset.geometry.margin ?? [0, 0]).join('x')}:${(asset.geometry.spacing ?? [0, 0]).join('x')}`
      : 'freeform';
    if (!bySource.has(entry.source)) bySource.set(entry.source, new Map());
    if (!bySource.get(entry.source).has(signature)) bySource.get(entry.source).set(signature, []);
    bySource.get(entry.source).get(signature).push(asset);
  }
  const sources = [];
  for (const [source, layouts] of bySource) {
    const image = await loadImage(resolveUnder(root, source));
    const canvas = createCanvas(image.width, image.height); const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const visible = (x, y) => pixels[(y * image.width + x) * 4 + 3] > 0;
    const candidates = [];
    for (const [signature, assets] of layouts) {
      const geometry = assets[0].geometry;
      if (geometry.layout === 'freeform') {
        const rects = assets.flatMap((asset) => Object.values(asset.frames ?? {}).map((frame) => frame.rect).filter(Boolean));
        let visiblePixels = 0; let mappedVisiblePixels = 0; let minX = image.width; let minY = image.height; let maxX = -1; let maxY = -1;
        for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (visible(x, y)) {
          visiblePixels += 1;
          if (rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh)) mappedVisiblePixels += 1;
          else { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        }
        const complete = visiblePixels === mappedVisiblePixels;
        candidates.push({ layout: 'freeform', signature, mapped_regions: rects.length, visible_alpha_pixels: visiblePixels, mapped_visible_alpha_pixels: mappedVisiblePixels, unmapped_alpha_pixels: visiblePixels - mappedVisiblePixels, ...(complete ? {} : { unmapped_bounds: [minX, minY, maxX - minX + 1, maxY - minY + 1] }), complete, coverage: visiblePixels ? mappedVisiblePixels / visiblePixels : 1 });
        continue;
      }
      const [cellWidth, cellHeight] = geometry.cell; const [columns, rows] = geometry.grid;
      const margin = geometry.margin ?? [0, 0]; const spacing = geometry.spacing ?? [0, 0];
      const mapped = new Set();
      for (const asset of assets) for (const frame of Object.values(asset.frames ?? {})) if (frame.cell) {
        mapped.add(frame.cell.join(','));
        const animation = asset.autotile?.animation;
        if (animation?.mode === 'grid-offset') for (let phase = 1; phase < animation.frames; phase += 1) mapped.add([frame.cell[0] + animation.phase_stride[0] * phase, frame.cell[1] + animation.phase_stride[1] * phase].join(','));
      }
      const nonempty = [];
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const sx = margin[0] + column * (cellWidth + spacing[0]); const sy = margin[1] + row * (cellHeight + spacing[1]);
        let hasAlpha = false;
        for (let y = sy; !hasAlpha && y < sy + cellHeight; y += 1) for (let x = sx; x < sx + cellWidth; x += 1) if (visible(x, y)) { hasAlpha = true; break; }
        if (hasAlpha) nonempty.push(`${column},${row}`);
      }
      const mappedNonempty = nonempty.filter((cell) => mapped.has(cell));
      const unmapped = nonempty.filter((cell) => !mapped.has(cell));
      candidates.push({ layout: 'grid', signature, cell: geometry.cell, grid: geometry.grid, nonempty_cells: nonempty.length, mapped_nonempty_cells: mappedNonempty.length, unmapped_nonempty_cells: unmapped.length, unmapped_examples: unmapped.slice(0, 12).map((cell) => cell.split(',').map(Number)), complete: unmapped.length === 0, coverage: nonempty.length ? mappedNonempty.length / nonempty.length : 1 });
    }
    candidates.sort((left, right) => Number(right.complete) - Number(left.complete) || right.coverage - left.coverage);
    sources.push({ source, complete: candidates[0]?.complete ?? false, coverage: candidates[0]?.coverage ?? 0, best: candidates[0] ?? null, candidates });
  }
  return sources.sort((left, right) => left.source.localeCompare(right.source));
}

/** Enumerate animation readiness without confusing measured files with curated motion. */
export async function auditAnimationMetadataCoverage({ root, catalogPath, dispositionsPath = null }) {
  const catalog = await loadAssetCatalog(catalogPath);
  const catalogValidation = validatePresentationCatalog(catalog);
  const runtime = [];
  const reviewedSources = new Set();
  const approvedNonSpriteSources = new Set();
  for (const [id, asset] of Object.entries(catalog.assets ?? {})) {
    if (asset.status !== 'approved') continue;
    if (!isSpriteAsset(asset)) { approvedNonSpriteSources.add(asset.source); continue; }
    reviewedSources.add(asset.source);
    const mode = asset.animation?.mode ?? 'missing';
    const states = Object.entries(asset.animation?.states ?? {});
    const directionalStates = states.filter(([, state]) => state.facings).map(([state]) => state);
    runtime.push({
      id, source: asset.source, kind: asset.kind, tags: asset.tags ?? [], mode,
      frames: Object.keys(asset.frames ?? {}).length, clips: Object.keys(asset.clips ?? {}).length,
      temporal: Object.values(asset.clips ?? {}).some((clip) => (clip.frames?.length ?? 0) > 1),
      states: states.map(([state]) => state), directional_states: directionalStates,
      control_scheme: asset.animation?.control?.scheme ?? null,
      ready: ['static', 'state-machine'].includes(mode),
      ...(mode === 'deferred' ? { reason: asset.animation.reason } : {}),
      asset,
    });
  }
  for (const source of reviewedSources) approvedNonSpriteSources.delete(source);
  const sourceCoverage = await runtimeSpriteSourceCoverage(root, runtime);
  const sourceCoverageBySource = new Map(sourceCoverage.map((entry) => [entry.source, entry]));
  for (const entry of runtime) {
    entry.source_coverage = sourceCoverageBySource.get(entry.source)?.coverage ?? 0;
    delete entry.asset;
  }
  const canonicalFiles = await walk(resolveUnder(root, 'assets'));
  const candidates = canonicalFiles
    .filter((file) => path.extname(file).toLowerCase() === '.png')
    .map((file) => posixRelative(root, file))
    .filter((source) => SPRITE_PATH_PATTERN.test(`/${source}`) && !approvedNonSpriteSources.has(source));
  const deferredSources = candidates.filter((source) => !reviewedSources.has(source));
  const candidateSet = new Set(candidates);
  const runtimeCandidateCoverage = sourceCoverage.filter((entry) => candidateSet.has(entry.source));
  const fullyMappedCandidateSources = runtimeCandidateCoverage.filter((entry) => entry.complete).length;
  const dispositionErrors = []; let dispositionRules = [];
  if (dispositionsPath) {
    let manifest;
    try { manifest = YAML.parse(await readFile(dispositionsPath, 'utf8')) ?? {}; }
    catch (error) { dispositionErrors.push(`cannot parse animation source dispositions: ${error.message}`); }
    if (manifest && (manifest.schema_version !== 1 || manifest.kind !== 'animation-source-dispositions' || !Array.isArray(manifest.rules))) dispositionErrors.push('animation source dispositions must be schema v1 with kind animation-source-dispositions and rules');
    dispositionRules = (manifest?.rules ?? []).map((rule, index) => {
      const prefix = `animation disposition rule ${index}`;
      if (!validId(rule?.id)) dispositionErrors.push(`${prefix}: id is invalid`);
      if (typeof rule?.match !== 'string' || !rule.match.trim()) dispositionErrors.push(`${prefix}: match glob is required`);
      if (!['family-deferred', 'layered-component', 'non-runtime-static'].includes(rule?.disposition)) dispositionErrors.push(`${prefix}: disposition is invalid`);
      if (!String(rule?.reason ?? '').trim()) dispositionErrors.push(`${prefix}: reason is required`);
      if (!Array.isArray(rule?.required_qa) || !rule.required_qa.length || rule.required_qa.some((entry) => typeof entry !== 'string' || !entry.trim())) dispositionErrors.push(`${prefix}: required_qa must be a non-empty string array`);
      return { ...rule, pattern: typeof rule?.match === 'string' ? globPattern(rule.match) : /^$/ };
    });
  }
  const deferred = deferredSources.map((source) => {
    const matches = dispositionRules.filter((rule) => rule.pattern.test(source));
    if (dispositionsPath && matches.length !== 1) dispositionErrors.push(`${source}: expected exactly one animation disposition rule, matched ${matches.length}`);
    const rule = matches[0];
    return rule ? { source, rule: rule.id, disposition: rule.disposition, reason: rule.reason, required_qa: [...rule.required_qa] } : { source, disposition: 'unclassified' };
  });
  const incomplete = runtime.filter((asset) => !asset.ready);
  const controlled = runtime.filter((asset) => asset.control_scheme);
  const animated = runtime.filter((asset) => asset.mode === 'state-machine');
  const summary = {
    canonical_sprite_candidates: candidates.length,
    runtime_sprite_assets: runtime.length,
    runtime_static: runtime.filter((asset) => asset.mode === 'static').length,
    runtime_animated: animated.length,
    runtime_temporally_animated: runtime.filter((asset) => asset.temporal).length,
    runtime_controlled: controlled.length,
    runtime_deferred_or_missing: incomplete.length,
    runtime_unique_sources: sourceCoverage.length,
    runtime_sources_fully_mapped: sourceCoverage.filter((entry) => entry.complete).length,
    runtime_sources_partial_or_unmeasured: sourceCoverage.filter((entry) => !entry.complete).length,
    canonical_deferred: deferredSources.length,
    canonical_classified_deferred: deferred.filter((entry) => entry.disposition !== 'unclassified').length,
    canonical_unclassified: deferred.filter((entry) => entry.disposition === 'unclassified').length,
    catalog_source_presence: candidates.length ? (candidates.length - deferredSources.length) / candidates.length : 1,
    semantic_source_coverage: candidates.length ? fullyMappedCandidateSources / candidates.length : 1,
    runtime_candidate_sources_fully_mapped: fullyMappedCandidateSources,
  };
  const runtimeValid = catalogValidation.valid && incomplete.length === 0;
  const dispositionValid = dispositionErrors.length === 0 && deferred.every((entry) => entry.disposition !== 'unclassified');
  const libraryComplete = runtimeValid && deferredSources.length === 0 && sourceCoverage.every((entry) => entry.complete);
  return {
    valid: libraryComplete,
    runtime_valid: runtimeValid,
    disposition_valid: dispositionValid,
    library_complete: libraryComplete,
    errors: [...catalogValidation.errors, ...dispositionErrors],
    summary,
    runtime,
    source_coverage: sourceCoverage,
    deferred_sources: deferred,
  };
}

function animationReferences(asset) {
  const references = [];
  for (const [state, descriptor] of Object.entries(asset.animation?.states ?? {})) {
    if (descriptor.clip) references.push({ kind: 'state', state, facing: null, motion: descriptor.motion, reference: descriptor.clip });
    for (const [facing, reference] of Object.entries(descriptor.facings ?? {})) references.push({ kind: 'state', state, facing, motion: descriptor.motion, reference });
  }
  for (const [transition, descriptor] of Object.entries(asset.animation?.transitions ?? {})) {
    if (descriptor.clip) references.push({ kind: 'transition', state: `transition.${transition}`, transition, facing: null, motion: 'in-place', reference: descriptor.clip });
    for (const [facing, reference] of Object.entries(descriptor.facings ?? {})) references.push({ kind: 'transition', state: `transition.${transition}`, transition, facing, motion: 'in-place', reference });
  }
  return references;
}

function animationClipDescriptor(reference) {
  return typeof reference === 'string' ? { clip: reference, flip_x: false } : { clip: reference.clip, flip_x: reference.flip_x ?? false };
}

function animationSequence(clip) {
  const entries = clip.frames.map((entry) => typeof entry === 'string'
    ? { frame: entry, delayCentisecs: Math.max(1, Math.round(100 / clip.fps)) }
    : { frame: entry.frame, delayCentisecs: Math.max(1, Math.round(entry.duration_ms / 10)) });
  if (clip.loop === 'ping-pong' && entries.length > 2) return [...entries, ...entries.slice(1, -1).reverse()];
  return entries;
}

async function renderReviewedClip({ root, catalog, assetId, asset, kind = 'state', state, transition = null, facing, motion, reference, outDir, scale }) {
  const { createCanvas, loadImage } = await import('canvas');
  const { GifCodec, GifFrame, GifUtil } = await import('gifwrap');
  const descriptor = animationClipDescriptor(reference); const clip = asset.clips[descriptor.clip];
  const sequence = animationSequence(clip); const file = resolveUnder(root, asset.source);
  const facts = await imageFacts(file);
  if (facts.sha256 !== asset.source_sha256) throw new Error(`${assetId}: source_sha256 does not match ${asset.source}`);
  const image = await loadImage(file); const density = asset.pixel_density; const decoded = [];
  for (const entry of sequence) {
    const frame = asset.frames[entry.frame]; const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
    if (sx + sw > image.width || sy + sh > image.height) throw new Error(`${assetId}#${entry.frame}: source rectangle exceeds ${image.width}x${image.height}`);
    const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d'); sampleContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    const pixels = sampleContext.getImageData(0, 0, sw, sh).data; let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) if (pixels[(y * sw + x) * 4 + 3]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const bounds = maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
    const reviewedTransparent = frame.transparent === true && asset.tags?.includes('animation-layer');
    if (reviewedTransparent ? bounds !== null : (!bounds || !frame.content_bounds || bounds.some((value, index) => value !== frame.content_bounds[index]))) throw new Error(`${assetId}#${entry.frame}: ${reviewedTransparent ? 'transparent frame contains visible alpha' : `content_bounds do not match decoded alpha ${bounds?.join(',') ?? 'empty'}`}`);
    const logicalWidth = sw / density; const logicalHeight = sh / density;
    const anchor = anchorOffset(frame.anchor ?? asset.defaults?.anchor, logicalWidth, logicalHeight, 1 / density);
    const visible = bounds ? { x: bounds[0] / density - anchor[0], y: bounds[1] / density - anchor[1], width: bounds[2] / density, height: bounds[3] / density } : null;
    const scaleClass = asset.world?.scale_class; const expected = catalog.style_profiles?.[asset.style_profile]?.scale_classes?.[scaleClass]?.logical_height;
    const scaleFrame = frame.scale_reference ? asset.frames[frame.scale_reference] : frame;
    const subjectBounds = scaleFrame?.subject_bounds ?? scaleFrame?.content_bounds;
    if (!subjectBounds && !reviewedTransparent) throw new Error(`${assetId}#${entry.frame}: scale reference ${frame.scale_reference ?? entry.frame} needs subject_bounds or content_bounds`);
    const measuredHeight = subjectBounds ? subjectBounds[3] / density : null;
    const measuredWidth = subjectBounds ? subjectBounds[2] / density : null;
    const envelopeHeight = bounds ? bounds[3] / density : null; const envelopeWidth = bounds ? bounds[2] / density : null;
    if (!asset.tags?.includes('animation-layer') && (!expected || measuredHeight < expected[0] || measuredHeight > expected[1])) throw new Error(`${assetId}#${entry.frame}: logical content height ${measuredHeight} is outside ${scaleClass} range ${expected?.join('-') ?? 'missing'}`);
    const groundDelta = frame.ground_contact?.point
      ? frame.ground_contact.point[1] / density - anchor[1]
      : visible ? visible.y + visible.height : 0;
    if (asset.tags?.includes('ground-contact') && Math.abs(groundDelta) > 0.0001) throw new Error(`${assetId}#${entry.frame}: reviewed ground contact misses the fixed anchor by ${groundDelta}`);
    decoded.push({ ...entry, frame, sx, sy, sw, sh, bounds, anchor, visible, logical_height: measuredHeight, logical_width: measuredWidth, envelope_height: envelopeHeight, envelope_width: envelopeWidth, expected });
  }
  const qaProfile = clip.qa_profile ?? (motion === 'stationary' ? 'expressive' : 'tight');
  const qaLimits = { tight: [1.65, 2], expressive: [2.25, 4], transform: [6, 8], mechanism: [32, 16] }[qaProfile];
  const visibleDecoded = decoded.filter((entry) => entry.visible);
  const heightRatio = visibleDecoded.length ? Math.max(...visibleDecoded.map((entry) => entry.envelope_height)) / Math.min(...visibleDecoded.map((entry) => entry.envelope_height)) : 1;
  const widthRatio = visibleDecoded.length ? Math.max(...visibleDecoded.map((entry) => entry.envelope_width)) / Math.min(...visibleDecoded.map((entry) => entry.envelope_width)) : 1;
  if (heightRatio > qaLimits[0] || widthRatio > qaLimits[1]) throw new Error(`${assetId}#${descriptor.clip}: ${qaProfile} animation silhouette varies too much (height ${heightRatio.toFixed(2)}x, width ${widthRatio.toFixed(2)}x; limits ${qaLimits.join('x, ')}x)`);
  const minX = visibleDecoded.length ? Math.min(...visibleDecoded.map((entry) => entry.visible.x)) : -1; const minY = visibleDecoded.length ? Math.min(...visibleDecoded.map((entry) => entry.visible.y)) : -1;
  const maxX = visibleDecoded.length ? Math.max(...visibleDecoded.map((entry) => entry.visible.x + entry.visible.width)) : 1; const maxY = visibleDecoded.length ? Math.max(...visibleDecoded.map((entry) => entry.visible.y + entry.visible.height)) : 1;
  const margin = 2; const logicalWidth = Math.max(1, Math.ceil(maxX - minX + margin * 2)); const logicalHeight = Math.max(1, Math.ceil(maxY - minY + margin * 2));
  const anchorTarget = [(margin - minX) * scale, (margin - minY) * scale];
  const canvases = decoded.map((entry) => {
    const canvas = createCanvas(logicalWidth * scale, logicalHeight * scale); const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const normalized = createCanvas(entry.sw / density, entry.sh / density); const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
    normalizedContext.drawImage(image, entry.sx, entry.sy, entry.sw, entry.sh, 0, 0, normalized.width, normalized.height);
    ctx.save(); ctx.translate(anchorTarget[0], anchorTarget[1]); ctx.scale(descriptor.flip_x ? -1 : 1, 1);
    ctx.drawImage(normalized, -entry.anchor[0] * scale, -entry.anchor[1] * scale, normalized.width * scale, normalized.height * scale); ctx.restore();
    return canvas;
  });
  const gifFrames = canvases.map((canvas, index) => new GifFrame(canvas.width, canvas.height, Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), { delayCentisecs: decoded[index].delayCentisecs }));
  GifUtil.quantizeWu(gifFrames, 256, 5); const gif = await new GifCodec().encodeGif(gifFrames, { loops: clip.loop === 'once' ? 1 : 0 });
  const name = `${state}${facing ? `-${facing}` : ''}`; const gifPath = path.join(outDir, assetId, `${name}.gif`); await ensureParent(gifPath); await writeFile(gifPath, gif.buffer);
  const strip = createCanvas(canvases[0].width * canvases.length, canvases[0].height); const stripContext = strip.getContext('2d'); stripContext.imageSmoothingEnabled = false;
  canvases.forEach((canvas, index) => stripContext.drawImage(canvas, index * canvas.width, 0));
  const stripPath = path.join(outDir, assetId, `${name}-strip.png`); await writeFile(stripPath, strip.toBuffer('image/png'));
  return { asset: assetId, kind, state, ...(transition ? { transition } : {}), facing, motion, clip: descriptor.clip, flip_x: descriptor.flip_x, qa_profile: qaProfile, frames: sequence.length, source_frames: clip.frames.length, logical_canvas: [logicalWidth, logicalHeight], logical_heights: decoded.map((entry) => entry.logical_height), logical_widths: decoded.map((entry) => entry.logical_width), envelope_heights: decoded.map((entry) => entry.envelope_height), envelope_widths: decoded.map((entry) => entry.envelope_width), silhouette_ratios: { height: heightRatio, width: widthRatio }, gif: posixRelative(outDir, gifPath), strip: posixRelative(outDir, stripPath) };
}

async function renderLayeredReviewedClip({ root, catalog, assetId, asset, state, facing, outDir, scale, equipment = null, assemblyId = null }) {
  const options = { state, facing: facing ?? 'south' };
  const resolved = equipment ? resolveRiggedAssetAnimation(catalog, assetId, { ...options, equipment }) : resolveLayeredAssetAnimation(catalog, assetId, options);
  if (resolved.layers.length < 2) return null;
  const prepared = [];
  for (const layer of resolved.layers) {
    const layerAsset = catalog.assets[layer.asset]; const file = resolveUnder(root, layerAsset.source); const facts = await imageFacts(file);
    if (facts.sha256 !== layerAsset.source_sha256) throw new Error(`${layer.asset}: source_sha256 does not match ${layerAsset.source}`);
    const { loadImage } = await import('canvas'); const image = await loadImage(file); const clip = layerAsset.clips[layer.clip];
    prepared.push({ layer, asset: layerAsset, facts, image, sequence: animationSequence(clip), clip });
  }
  const phaseCount = prepared[0].sequence.length;
  if (prepared.some((entry) => entry.sequence.length !== phaseCount)) throw new Error(`${assetId} state ${state}: layered rendered phase counts differ`);
  const phases = [];
  for (let phase = 0; phase < phaseCount; phase += 1) {
    const decoded = [];
    for (const entry of prepared) {
      const sequenceFrame = entry.sequence[phase]; const frame = entry.asset.frames[sequenceFrame.frame]; const [sx, sy, sw, sh] = frameRect(entry.asset, frame, entry.facts);
      const { createCanvas } = await import('canvas'); const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d'); sampleContext.drawImage(entry.image, sx, sy, sw, sh, 0, 0, sw, sh);
      const pixels = sampleContext.getImageData(0, 0, sw, sh).data; let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
      for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) if (pixels[(y * sw + x) * 4 + 3]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      const bounds = maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
      const reviewedTransparent = frame.transparent === true && entry.asset.tags?.includes('animation-layer');
      if (reviewedTransparent ? bounds !== null : (!bounds || !frame.content_bounds || bounds.some((value, index) => value !== frame.content_bounds[index]))) throw new Error(`${entry.layer.asset}#${sequenceFrame.frame}: ${reviewedTransparent ? 'transparent frame contains visible alpha' : `content_bounds do not match decoded alpha ${bounds?.join(',') ?? 'empty'}`}`);
      const density = entry.asset.pixel_density; const logicalWidth = sw / density; const logicalHeight = sh / density;
      const anchor = anchorOffset(frame.anchor ?? entry.asset.defaults?.anchor, logicalWidth, logicalHeight, 1 / density);
      decoded.push({ ...entry, sequenceFrame, frame, sx, sy, sw, sh, density, anchor, visible: bounds ? { x: bounds[0] / density - anchor[0], y: bounds[1] / density - anchor[1], width: bounds[2] / density, height: bounds[3] / density } : null });
    }
    phases.push(decoded);
  }
  const flat = phases.flat().filter((entry) => entry.visible); const minX = Math.min(...flat.map((entry) => entry.visible.x)); const minY = Math.min(...flat.map((entry) => entry.visible.y));
  const maxX = Math.max(...flat.map((entry) => entry.visible.x + entry.visible.width)); const maxY = Math.max(...flat.map((entry) => entry.visible.y + entry.visible.height));
  const margin = 2; const logicalWidth = Math.ceil(maxX - minX + margin * 2); const logicalHeight = Math.ceil(maxY - minY + margin * 2);
  const anchorTarget = [(margin - minX) * scale, (margin - minY) * scale]; const { createCanvas } = await import('canvas');
  const canvases = phases.map((decoded) => {
    const canvas = createCanvas(logicalWidth * scale, logicalHeight * scale); const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    for (const entry of decoded) {
      const normalized = createCanvas(entry.sw / entry.density, entry.sh / entry.density); const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
      normalizedContext.drawImage(entry.image, entry.sx, entry.sy, entry.sw, entry.sh, 0, 0, normalized.width, normalized.height);
      context.save(); context.translate(anchorTarget[0], anchorTarget[1]); context.scale(entry.layer.flip_x ? -1 : 1, 1);
      context.drawImage(normalized, -entry.anchor[0] * scale, -entry.anchor[1] * scale, normalized.width * scale, normalized.height * scale); context.restore();
    }
    return canvas;
  });
  const { GifCodec, GifFrame, GifUtil } = await import('gifwrap');
  const gifFrames = canvases.map((canvas, index) => new GifFrame(canvas.width, canvas.height, Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), { delayCentisecs: prepared[0].sequence[index].delayCentisecs }));
  GifUtil.quantizeWu(gifFrames, 256, 5); const gif = await new GifCodec().encodeGif(gifFrames, { loops: prepared[0].clip.loop === 'once' ? 1 : 0 });
  const name = `composite-${assemblyId ? `${assemblyId}-` : ''}${state}${facing ? `-${facing}` : ''}`; const gifPath = path.join(outDir, assetId, `${name}.gif`); await ensureParent(gifPath); await writeFile(gifPath, gif.buffer);
  const strip = createCanvas(canvases[0].width * canvases.length, canvases[0].height); const stripContext = strip.getContext('2d'); stripContext.imageSmoothingEnabled = false;
  canvases.forEach((canvas, index) => stripContext.drawImage(canvas, index * canvas.width, 0)); const stripPath = path.join(outDir, assetId, `${name}-strip.png`); await writeFile(stripPath, strip.toBuffer('image/png'));
  return { asset: assetId, ...(assemblyId ? { assembly: assemblyId, rig: resolved.rig } : {}), state, facing, layers: resolved.layers.map((layer) => ({ asset: layer.asset, role: layer.role, clip: layer.clip, flip_x: layer.flip_x })), frames: phaseCount, logical_canvas: [logicalWidth, logicalHeight], gif: posixRelative(outDir, gifPath), strip: posixRelative(outDir, stripPath) };
}

async function renderControlSimulation({ root, catalog, assetId, asset, outDir, scale, equipment = null, assemblyId = null, rigProfileId = null }) {
  const { createCanvas, loadImage } = await import('canvas'); const { GifCodec, GifFrame, GifUtil } = await import('gifwrap');
  const decodedSources = new Map();
  const decodedSource = async (id) => {
    if (decodedSources.has(id)) return decodedSources.get(id);
    const descriptor = catalog.assets[id]; const file = resolveUnder(root, descriptor.source); const facts = await imageFacts(file);
    if (facts.sha256 !== descriptor.source_sha256) throw new Error(`${id}: source_sha256 does not match ${descriptor.source}`);
    const decoded = { descriptor, facts, image: await loadImage(file), density: descriptor.pixel_density }; decodedSources.set(id, decoded); return decoded;
  };
  const controlScheme = rigProfileId ? catalog.animation_rigs[rigProfileId].control.scheme : asset.animation.control.scheme;
  const script = controlScheme === 'horizontal'
    ? [
      { moving: false, facing: 'east', frames: 4, delta: [0, 0] },
      { moving: true, facing: 'east', frames: 8, delta: [1, 0] },
      { moving: false, facing: 'east', frames: 3, delta: [0, 0] },
      { moving: true, facing: 'west', frames: 8, delta: [-1, 0] },
      { moving: false, facing: 'west', frames: 3, delta: [0, 0] },
    ]
    : [
      { moving: false, facing: 'south', frames: 4, delta: [0, 0] },
      { moving: true, facing: 'east', frames: 6, delta: [1, 0] },
      { moving: false, facing: 'east', frames: 3, delta: [0, 0] },
      { moving: true, facing: 'north', frames: 6, delta: [0, -1] },
      { moving: true, facing: 'west', frames: 6, delta: [-1, 0] },
      { moving: true, facing: 'south', frames: 6, delta: [0, 1] },
    ];
  const logicalSize = [96, 80]; const anchor = [40, 48]; const rendered = []; const trace = [];
  for (const step of script) {
    const resolved = rigProfileId ? resolveRiggedAnimationState(catalog, rigProfileId, { ...step, equipment }) : equipment ? resolveRiggedAssetAnimation(catalog, assetId, { ...step, equipment }) : resolveLayeredAssetAnimation(catalog, assetId, step);
    const prepared = [];
    for (const layer of resolved.layers) {
      const source = await decodedSource(layer.asset); const clip = source.descriptor.clips[layer.clip]; prepared.push({ layer, source, sequence: animationSequence(clip) });
    }
    const phaseCount = prepared[0].sequence.length;
    if (prepared.some((entry) => entry.sequence.length !== phaseCount)) throw new Error(`${assetId} control simulation: layered rendered phase counts differ`);
    for (let index = 0; index < step.frames; index += 1) {
      const canvas = createCanvas(logicalSize[0] * scale, logicalSize[1] * scale); const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#4f8a52'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#3f7745'; ctx.lineWidth = 1;
      for (let x = 0; x <= logicalSize[0]; x += 16) { ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= logicalSize[1]; y += 16) { ctx.beginPath(); ctx.moveTo(0, y * scale); ctx.lineTo(canvas.width, y * scale); ctx.stroke(); }
      ctx.fillStyle = 'rgba(20,25,30,0.35)'; ctx.beginPath(); ctx.ellipse(anchor[0] * scale, anchor[1] * scale, 5 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill();
      for (const entry of prepared) {
        const sequenceFrame = entry.sequence[index % phaseCount]; const frame = entry.source.descriptor.frames[sequenceFrame.frame];
        const [sx, sy, sw, sh] = frameRect(entry.source.descriptor, frame, entry.source.facts);
        if (sx + sw > entry.source.image.width || sy + sh > entry.source.image.height) throw new Error(`${entry.layer.asset}#${sequenceFrame.frame}: source rectangle exceeds image`);
        const normalized = createCanvas(sw / entry.source.density, sh / entry.source.density); const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
        normalizedContext.drawImage(entry.source.image, sx, sy, sw, sh, 0, 0, normalized.width, normalized.height);
        const frameAnchor = anchorOffset(frame.anchor ?? entry.source.descriptor.defaults?.anchor, normalized.width, normalized.height);
        ctx.save(); ctx.translate(anchor[0] * scale, anchor[1] * scale); ctx.scale(entry.layer.flip_x ? -1 : 1, 1);
        ctx.drawImage(normalized, -frameAnchor[0] * scale, -frameAnchor[1] * scale, normalized.width * scale, normalized.height * scale); ctx.restore();
      }
      rendered.push(new GifFrame(canvas.width, canvas.height, Buffer.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data), { delayCentisecs: 12 }));
      trace.push({ moving: step.moving, facing: step.facing, state: resolved.state, layers: resolved.layers.map((layer) => ({ asset: layer.asset, clip: layer.clip, flip_x: layer.flip_x })), at: [...anchor] });
      if (step.moving) { anchor[0] += step.delta[0]; anchor[1] += step.delta[1]; }
    }
  }
  GifUtil.quantizeWu(rendered, 256, 5); const gif = await new GifCodec().encodeGif(rendered, { loops: 0 });
  const out = path.join(outDir, assetId, `control-simulation${assemblyId ? `-${assemblyId}` : ''}.gif`); await ensureParent(out); await writeFile(out, gif.buffer);
  return { asset: assetId, ...(assemblyId ? { assembly: assemblyId } : {}), gif: posixRelative(outDir, out), frames: rendered.length, logical_size: logicalSize, script, trace };
}

/** Render every reachable reviewed clip at one fixed world anchor. */
export async function renderAnimationQaSet({ root, catalogPath, outDir, scale = 4, asset: assetSelector = null }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('animation QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath); const catalogValidation = validatePresentationCatalog(catalog);
  const decodedValidation = await validateManifest({ root, manifestPath: catalogPath });
  const artifacts = []; const layeredComposites = []; const controlSimulations = []; const actionReturns = []; const terminalActions = []; const errors = [...new Set([...catalogValidation.errors, ...decodedValidation.errors])]; const deferred = [];
  const selected = (assetId) => !assetSelector || assetId === assetSelector || assetId.startsWith(assetSelector);
  if (assetSelector && !Object.keys(catalog.assets ?? {}).some(selected)) throw new Error(`no catalog assets match --asset ${assetSelector}`);
  const selectedRigProfiles = new Set(Object.entries(catalog.assets ?? {}).filter(([id, descriptor]) => selected(id) && descriptor.animation?.rig && catalog.animation_rigs?.[descriptor.animation.rig.profile]?.base_slot === descriptor.animation.rig.slot).map(([, descriptor]) => descriptor.animation.rig.profile));
  const selectedForCoverage = (assetId) => selected(assetId) || selectedRigProfiles.has(catalog.assets?.[assetId]?.animation?.rig?.profile);
  for (const [assetId, asset] of Object.entries(catalog.assets ?? {})) {
    if (!selected(assetId)) continue;
    if (asset.status !== 'approved' || !isSpriteAsset(asset)) continue;
    if (asset.animation?.mode === 'deferred' || !asset.animation) { deferred.push({ asset: assetId, reason: asset.animation?.reason ?? 'missing animation disposition' }); continue; }
    if (asset.animation.mode !== 'state-machine') continue;
    const rigProfile = asset.animation.rig ? catalog.animation_rigs?.[asset.animation.rig.profile] : null;
    if (rigProfile && asset.animation.rig.slot !== rigProfile.base_slot) continue;
    for (const entry of animationReferences(asset)) try {
      artifacts.push(await renderReviewedClip({ root, catalog, assetId, asset, ...entry, outDir, scale }));
    } catch (error) { errors.push(error.message); }
    if (asset.animation.layers) for (const entry of animationReferences(asset).filter((reference) => reference.kind === 'state')) try {
      const composite = await renderLayeredReviewedClip({ root, catalog, assetId, asset, state: entry.state, facing: entry.facing, outDir, scale });
      if (composite) layeredComposites.push(composite);
    } catch (error) { errors.push(error.message); }
    if (asset.animation.control) try { controlSimulations.push(await renderControlSimulation({ root, catalog, assetId, asset, outDir, scale })); } catch (error) { errors.push(error.message); }
  }
  for (const [profileId, profile] of Object.entries(catalog.animation_rigs ?? {})) for (const assembly of profile.qa_assemblies ?? []) {
    if (!selected(assembly.base)) continue;
    const base = catalog.assets[assembly.base];
    if (!base || base.animation?.rig?.profile !== profileId) continue;
    for (const entry of animationReferences(base).filter((reference) => reference.kind === 'state')) try {
      const composite = await renderLayeredReviewedClip({ root, catalog, assetId: assembly.base, asset: base, state: entry.state, facing: entry.facing, equipment: assembly.equipment, assemblyId: assembly.id, outDir, scale });
      if (composite) layeredComposites.push(composite);
    } catch (error) { errors.push(error.message); }
    if (base.animation.control) try { controlSimulations.push(await renderControlSimulation({ root, catalog, assetId: assembly.base, asset: base, equipment: assembly.equipment, assemblyId: assembly.id, outDir, scale })); } catch (error) { errors.push(error.message); }
    if (assembly.control && profile.control) try { controlSimulations.push(await renderControlSimulation({ root, catalog, assetId: assembly.base, asset: base, equipment: assembly.equipment, assemblyId: assembly.id, rigProfileId: profileId, outDir, scale })); } catch (error) { errors.push(error.message); }
  }
  for (const [assetId, asset] of Object.entries(catalog.assets ?? {})) if (selected(assetId) && asset.animation?.control) {
    for (const state of [asset.animation.control.idle_state, asset.animation.control.move_state]) {
      const stateArtifacts = artifacts.filter((entry) => entry.asset === assetId && entry.state === state && entry.facing);
      if (!stateArtifacts.length) continue;
      const facingHeights = stateArtifacts.map((entry) => entry.logical_heights.reduce((sum, value) => sum + value, 0) / entry.logical_heights.length);
      const facingRatio = Math.max(...facingHeights) / Math.min(...facingHeights);
      if (facingRatio > 1.35) errors.push(`${assetId} state ${state}: directional median scale differs by ${facingRatio.toFixed(2)}x (limit 1.35x)`);
    }
  }
  for (const [assetId, asset] of Object.entries(catalog.assets ?? {})) if (selected(assetId) && asset.status === 'approved' && isSpriteAsset(asset) && asset.animation?.mode === 'state-machine') {
    const rigProfile = asset.animation.rig ? catalog.animation_rigs?.[asset.animation.rig.profile] : null;
    if (rigProfile && asset.animation.rig.slot !== rigProfile.base_slot) continue;
    for (const [stateId, state] of Object.entries(asset.animation.states ?? {})) {
      if (state.terminal === true) terminalActions.push({ asset: assetId, state: stateId });
      if (!state.return_to) continue;
      const facings = state.facings ? Object.keys(state.facings) : [null];
      for (const facing of facings) try {
        const actionArtifact = artifacts.find((entry) => entry.asset === assetId && entry.kind === 'state' && entry.state === stateId && entry.facing === facing);
        if (!actionArtifact) throw new Error(`${assetId} state ${stateId}: missing rendered one-shot artifact${facing ? ` for ${facing}` : ''}`);
        const returned = asset.animation.states?.[state.return_to]
          ? resolveAssetAnimation(asset, { state: state.return_to, facing: facing ?? 'south' })
          : resolveRiggedAnimationState(catalog, asset.animation.rig?.profile, { state: state.return_to, facing: facing ?? 'south' });
        actionReturns.push({ asset: assetId, state: stateId, facing, clip: actionArtifact.clip, return_to: state.return_to, return_clip: returned.clip, return_flip_x: returned.flip_x });
      } catch (error) { errors.push(error.message); }
    }
  }
  const animatedIds = new Set(artifacts.map((entry) => entry.asset));
  const registeredAnimationLayerIds = new Set(Object.entries(catalog.assets ?? {}).filter(([id, descriptor]) => selectedForCoverage(id) && descriptor.status === 'approved' && descriptor.animation?.mode === 'state-machine' && descriptor.tags?.includes('animation-layer')).map(([id]) => id));
  const animationLayerIds = new Set([...registeredAnimationLayerIds]);
  const actorIds = new Set([...animatedIds].filter((id) => catalog.assets[id]?.tags?.includes('actor') && !animationLayerIds.has(id)));
  const objectIds = new Set([...animatedIds].filter((id) => !catalog.assets[id]?.tags?.includes('actor') && !animationLayerIds.has(id)));
  const temporalIds = new Set(artifacts.filter((entry) => entry.source_frames > 1).map((entry) => entry.asset));
  const temporalActorIds = new Set([...temporalIds].filter((id) => catalog.assets[id]?.tags?.includes('actor')));
  const temporalObjectIds = new Set([...temporalIds].filter((id) => !catalog.assets[id]?.tags?.includes('actor') && !animationLayerIds.has(id)));
  const temporalAnimationLayerIds = new Set([...animationLayerIds].filter((id) => Object.values(catalog.assets[id]?.clips ?? {}).some((clip) => clip.frames?.length > 1)));
  const layeredIds = new Set(layeredComposites.map((entry) => entry.asset));
  const report = { schema_version: 1, kind: 'animation-qa-report', valid: errors.length === 0 && deferred.length === 0, catalog: path.resolve(catalogPath), ...(assetSelector ? { asset_selector: assetSelector } : {}), artifacts, layered_composites: layeredComposites, control_simulations: controlSimulations, action_returns: actionReturns, terminal_actions: terminalActions, deferred, errors, summary: { animated_assets: animatedIds.size, animated_actors: actorIds.size, animated_objects: objectIds.size, animation_layer_assets: animationLayerIds.size, temporally_animated_assets: temporalIds.size, temporally_animated_actors: temporalActorIds.size, temporally_animated_objects: temporalObjectIds.size, temporally_animated_layers: temporalAnimationLayerIds.size, layered_assets: layeredIds.size, composite_clips: layeredComposites.length, controlled_assets: controlSimulations.length, action_returns: actionReturns.length, terminal_actions: terminalActions.length, state_clips: artifacts.filter((entry) => entry.kind === 'state').length, transition_clips: artifacts.filter((entry) => entry.kind === 'transition').length, clips: artifacts.length, deferred: deferred.length, errors: errors.length } };
  await writeYaml(path.join(outDir, 'report.yml'), report);
  return report;
}

export async function renderLayout({ root, manifestPath, out }) {
  const layout = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  if (!validPair(layout.viewport)) throw new Error('layout viewport must be [width, height]');
  if (!Array.isArray(layout.sprites)) throw new Error('layout sprites must be an array');
  const [width, height] = layout.viewport;
  const { loadImage } = await import('canvas');
  const { canvas, ctx } = await createPixelCanvas(width, height);
  ctx.fillStyle = layout.background ?? '#000000';
  ctx.fillRect(0, 0, width, height);
  for (const [index, sprite] of layout.sprites.entries()) {
    const prefix = `sprite ${index}`;
    const file = resolveUnder(root, sprite.source);
    if (!validPair(sprite.cell)) throw new Error(`${prefix}: cell must be [width, height]`);
    if (!validCoordinate(sprite.frame) || !validCoordinate(sprite.at)) throw new Error(`${prefix}: frame and at must be [x, y]`);
    const [cellW, cellH] = sprite.cell;
    const [column, row] = sprite.frame;
    const image = await loadImage(file);
    if ((column + 1) * cellW > image.width || (row + 1) * cellH > image.height) throw new Error(`${prefix}: frame exceeds source`);
    const scale = sprite.scale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`${prefix}: scale must be positive`);
    const repeat = sprite.repeat ?? [1, 1];
    if (!validPair(repeat)) throw new Error(`${prefix}: repeat must be [columns, rows]`);
    for (let repeatY = 0; repeatY < repeat[1]; repeatY += 1) for (let repeatX = 0; repeatX < repeat[0]; repeatX += 1) {
      ctx.drawImage(image, column * cellW, row * cellH, cellW, cellH,
        sprite.at[0] + repeatX * cellW * scale, sprite.at[1] + repeatY * cellH * scale, cellW * scale, cellH * scale);
    }
  }
  await ensureParent(out);
  await writeFile(out, canvas.toBuffer('image/png'));
  return { sprites: layout.sprites.length, out, width, height };
}

function resolveCatalogFrame(catalog, reference, frameName = 'default') {
  const [assetId, inlineFrame] = String(reference).split('#');
  const asset = catalog.assets?.[assetId];
  if (!asset || asset.status !== 'approved') throw new Error(`scene references unavailable asset: ${assetId}`);
  const resolvedFrameName = inlineFrame ?? frameName;
  const frame = asset.frames?.[resolvedFrameName];
  if (!frame) throw new Error(`asset ${assetId} has no frame: ${resolvedFrameName}`);
  return { asset, frame, frameName: resolvedFrameName };
}

function anchorOffset(anchor, width, height, scale = 1) {
  const named = { 'top-left': [0, 0], 'top-center': [width / 2, 0], 'top-right': [width, 0], 'center-left': [0, height / 2], center: [width / 2, height / 2], 'center-right': [width, height / 2], 'bottom-left': [0, height], 'bottom-center': [width / 2, height], 'bottom-right': [width, height] };
  return Array.isArray(anchor?.point) ? anchor.point.map((value) => value * scale) : (named[anchor] ?? named['top-left']);
}

function assertKnownFields(value, allowed, prefix) {
  const unknown = Object.keys(value ?? {}).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`${prefix} has unsupported fields: ${unknown.join(', ')}`);
}

function intersectingViewport(bounds, width, height) {
  return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height;
}

async function renderPresentationPlan({ root, catalog, plan, out }) {
  const { createCanvas, loadImage } = await import('canvas');
  const [logicalWidth, logicalHeight] = plan.logical_size; const scale = plan.pixel_scale;
  const width = logicalWidth * scale; const height = logicalHeight * scale;
  const { canvas, ctx } = await createPixelCanvas(width, height);
  ctx.fillStyle = plan.background; ctx.fillRect(0, 0, width, height);
  const images = new Map(); const facts = new Map(); const normalizedFrames = new Map(); const alphaFrames = new Map(); const clipping = []; const sourceEdgeContacts = []; const scaleAudit = new Map(); const compositionSubjects = []; const placementRepeats = new Map();
  const imageFor = async (assetId, asset) => {
    const file = resolveUnder(root, asset.source);
    if (!facts.has(file)) facts.set(file, await imageFacts(file));
    const fileFacts = facts.get(file);
    if (fileFacts.sha256 !== asset.source_sha256) throw new Error(`asset ${assetId}: source_sha256 does not match ${asset.source}`);
    if (!images.has(file)) images.set(file, await loadImage(file));
    return { image: images.get(file), facts: fileFacts };
  };
  for (const command of plan.commands) {
    if (command.type === 'fill') {
      ctx.save();
      if (command.clip_polygon) {
        ctx.beginPath(); command.clip_polygon.forEach(([x, y], index) => ctx[index ? 'lineTo' : 'moveTo']((command.at[0] + x) * scale, (command.at[1] + y) * scale));
        ctx.closePath(); ctx.clip();
      }
      ctx.globalAlpha = command.opacity; ctx.fillStyle = command.color;
      ctx.fillRect(command.at[0] * scale, command.at[1] * scale, command.size[0] * scale, command.size[1] * scale); ctx.restore();
      continue;
    }
    if (command.type === 'shadow') {
      ctx.save(); ctx.globalAlpha = command.opacity; ctx.fillStyle = command.color;
      ctx.beginPath(); ctx.ellipse(command.at[0] * scale, command.at[1] * scale, command.size[0] * scale / 2, command.size[1] * scale / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      continue;
    }
    const asset = catalog.assets[command.asset]; const frame = asset.frames[command.frame];
    const loaded = await imageFor(command.asset, asset);
    const [sx, sy, sw, sh] = frameRect(asset, frame, loaded.facts, command.source_cell_offset);
    if (sx < 0 || sy < 0 || sw < 1 || sh < 1 || sx + sw > loaded.facts.image.width || sy + sh > loaded.facts.image.height) {
      throw new Error(`asset ${command.asset}#${command.frame}: source rectangle ${sx},${sy},${sw},${sh} exceeds ${loaded.facts.image.width}x${loaded.facts.image.height} source ${asset.source}`);
    }
    const alphaKey = `${command.asset}#${command.frame}:${command.source_cell_offset.join(',')}`;
    if (!alphaFrames.has(alphaKey)) {
      const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d'); sampleContext.drawImage(loaded.image, sx, sy, sw, sh, 0, 0, sw, sh);
      const pixels = sampleContext.getImageData(0, 0, sw, sh).data; let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
      for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) if (pixels[(y * sw + x) * 4 + 3]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      alphaFrames.set(alphaKey, maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1]);
    }
    const alphaBounds = alphaFrames.get(alphaKey);
    if (frame.content_bounds && alphaBounds && frame.content_bounds.some((value, index) => value !== alphaBounds[index])) throw new Error(`asset ${command.asset}#${command.frame}: content_bounds ${frame.content_bounds.join(',')} do not match decoded alpha ${alphaBounds.join(',')}`);
    if (alphaBounds) {
      const scaleClass = catalog.style_profiles[asset.style_profile].scale_classes[asset.world.scale_class];
      const logicalHeight = alphaBounds[3] / asset.pixel_density; const [minimumHeight, maximumHeight] = scaleClass.logical_height;
      const scaleKey = `${command.asset}#${command.frame}`; const existingScale = scaleAudit.get(scaleKey);
      if (existingScale) existingScale.draws += 1;
      else scaleAudit.set(scaleKey, { asset: command.asset, frame: command.frame, scale_class: asset.world.scale_class, logical_height: logicalHeight, expected: scaleClass.logical_height, draws: 1 });
      if (logicalHeight < minimumHeight || logicalHeight > maximumHeight) throw new Error(`asset ${command.asset}#${command.frame}: logical content height ${logicalHeight} is outside ${asset.world.scale_class} range ${minimumHeight}-${maximumHeight}`);
      const contacts = [...(alphaBounds[1] === 0 ? ['north'] : []), ...(alphaBounds[0] + alphaBounds[2] === sw ? ['east'] : []), ...(alphaBounds[1] + alphaBounds[3] === sh ? ['south'] : []), ...(alphaBounds[0] === 0 ? ['west'] : [])];
      if (contacts.length) {
        sourceEdgeContacts.push({ asset: command.asset, frame: command.frame, contacts, policy: asset.edge_policy, provenance: command.provenance });
        const allowed = frame.edge_contact?.allowed ?? [];
        const unexpected = asset.edge_policy === 'seamless' ? [] : contacts.filter((side) => !allowed.includes(side));
        if (unexpected.length) throw new Error(`asset ${command.asset}#${command.frame}: decoded alpha touches undeclared ${unexpected.join(', ')} frame edge`);
      }
    }
    const density = asset.pixel_density; const dw = sw / density * scale; const dh = sh / density * scale;
    const [ax, ay] = anchorOffset(frame.anchor ?? asset.defaults?.anchor, dw, dh, scale / density);
    const dx = command.at[0] * scale - ax; const dy = command.at[1] * scale - ay;
    const content = frame.content_bounds;
    const visible = content
      ? { x: dx + content[0] / density * scale, y: dy + content[1] / density * scale, width: content[2] / density * scale, height: content[3] / density * scale }
      : { x: dx, y: dy, width: dw, height: dh };
    if (alphaBounds && command.provenance?.startsWith('placement:')) compositionSubjects.push({ ...visible, provenance: command.provenance, asset: command.asset, frame: command.frame, scale_class: asset.world.scale_class, semantic_role: command.semantic_role });
    if (alphaBounds && command.provenance?.startsWith('placement:')) {
      const repeatKey = `${command.asset}#${command.frame}`; placementRepeats.set(repeatKey, (placementRepeats.get(repeatKey) ?? 0) + 1);
    }
    if (visible.x < -0.001 || visible.y < -0.001 || visible.x + visible.width > width + 0.001 || visible.y + visible.height > height + 0.001) clipping.push({ asset: command.asset, frame: command.frame, bounds: visible, provenance: command.provenance });
    let sourceImage = loaded.image; let sourceX = sx; let sourceY = sy; let sourceWidth = sw; let sourceHeight = sh;
    if (density > 1) {
      const normalizedKey = `${command.asset}#${command.frame}:${command.source_cell_offset.join(',')}`;
      if (!normalizedFrames.has(normalizedKey)) {
        const normalized = createCanvas(sw / density, sh / density); const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
        normalizedContext.drawImage(loaded.image, sx, sy, sw, sh, 0, 0, normalized.width, normalized.height); normalizedFrames.set(normalizedKey, normalized);
      }
      sourceImage = normalizedFrames.get(normalizedKey); sourceX = 0; sourceY = 0; sourceWidth = sourceImage.width; sourceHeight = sourceImage.height;
    }
    ctx.save();
    if (command.clip_polygon) {
      ctx.beginPath();
      command.clip_polygon.forEach(([x, y], index) => ctx[index ? 'lineTo' : 'moveTo']((command.at[0] + x) * scale, (command.at[1] + y) * scale));
      ctx.closePath(); ctx.clip();
    }
    ctx.globalAlpha = command.opacity;
    ctx.translate(command.at[0] * scale, command.at[1] * scale); ctx.rotate(command.rotation * Math.PI / 180); ctx.scale(command.flip_x ? -1 : 1, 1);
    ctx.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, -ax, -ay, dw, dh); ctx.restore();
  }
  const compositionContract = catalog.style_profiles[plan.style_profile].composition;
  const [sectorColumns, sectorRows] = compositionContract.sector_grid; const occupiedSectors = new Set();
  const occupiedCells = new Set(); const [gridCellWidth, gridCellHeight] = plan.grid.cell;
  for (const subject of compositionSubjects) {
    const centerX = Math.min(width - 0.0001, Math.max(0, subject.x + subject.width / 2)); const centerY = Math.min(height - 0.0001, Math.max(0, subject.y + subject.height / 2));
    occupiedSectors.add(`${Math.floor(centerX / width * sectorColumns)},${Math.floor(centerY / height * sectorRows)}`);
    const left = Math.max(0, Math.floor(subject.x / scale / gridCellWidth)); const top = Math.max(0, Math.floor(subject.y / scale / gridCellHeight));
    const right = Math.min(plan.grid.columns - 1, Math.floor((subject.x + subject.width - 0.0001) / scale / gridCellWidth)); const bottom = Math.min(plan.grid.rows - 1, Math.floor((subject.y + subject.height - 0.0001) / scale / gridCellHeight));
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) occupiedCells.add(`${x},${y}`);
  }
  const placementDraws = [...placementRepeats.values()].reduce((sum, count) => sum + count, 0); const largestRepeat = Math.max(0, ...placementRepeats.values());
  const semanticRoleCounts = plan.diagnostics.semantic_roles ?? {}; const semanticRoleTotal = Object.values(semanticRoleCounts).reduce((sum, count) => sum + count, 0); const largestRole = Math.max(0, ...Object.values(semanticRoleCounts));
  const composition = {
    ...plan.diagnostics.composition,
    subjects: compositionSubjects.length,
    occupied_sectors: occupiedSectors.size,
    sector_count: sectorColumns * sectorRows,
    visual_coverage: occupiedCells.size / (plan.grid.columns * plan.grid.rows),
    placement_draws: placementDraws,
    unique_placement_frames: placementRepeats.size,
    repeat_ratio: placementDraws ? largestRepeat / placementDraws : 0,
    semantic_roles: semanticRoleCounts,
    role_diversity: Object.keys(semanticRoleCounts).length,
    role_dominance: semanticRoleTotal ? largestRole / semanticRoleTotal : 0,
  };
  const [minimumCoverage, maximumCoverage] = compositionContract.visual_coverage; const compositionFailures = [];
  if (composition.occupied_sectors < compositionContract.minimum_occupied_sectors) compositionFailures.push(`occupied sectors ${composition.occupied_sectors} < ${compositionContract.minimum_occupied_sectors}`);
  if (composition.visual_coverage < minimumCoverage || composition.visual_coverage > maximumCoverage) compositionFailures.push(`visual coverage ${composition.visual_coverage.toFixed(4)} is outside ${minimumCoverage}-${maximumCoverage}`);
  if (composition.navigation_connectivity < compositionContract.minimum_navigation_connectivity) compositionFailures.push(`navigation connectivity ${composition.navigation_connectivity.toFixed(4)} < ${compositionContract.minimum_navigation_connectivity}`);
  if (composition.repeat_ratio > compositionContract.maximum_repeat_ratio) compositionFailures.push(`repeat ratio ${composition.repeat_ratio.toFixed(4)} > ${compositionContract.maximum_repeat_ratio}`);
  if (composition.role_diversity < compositionContract.minimum_role_diversity) compositionFailures.push(`role diversity ${composition.role_diversity} < ${compositionContract.minimum_role_diversity}`);
  if (composition.role_dominance > compositionContract.maximum_role_ratio) compositionFailures.push(`role dominance ${composition.role_dominance.toFixed(4)} > ${compositionContract.maximum_role_ratio}`);
  if (compositionFailures.length) throw new Error(`scene ${plan.scene} violates ${plan.style_profile} composition contract: ${compositionFailures.join('; ')}`);
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, width, height, logical_size: plan.logical_size, pixel_scale: scale, draws: plan.commands.length, plan_hash: plan.hash, diagnostics: { ...plan.diagnostics, composition, source_edge_contacts: sourceEdgeContacts, scale_audit: [...scaleAudit.values()] }, clipping };
}

/** Decode material fills and every interface band before any scene render.
 * A terrain material marked solid must be an opaque cell; sparse art belongs
 * in an overlay/component layer. Every interface must visibly differ from the
 * outside material along every cardinal edge and meet the receiving fill
 * exactly where the two cells touch; metadata may raise the band default. */
export async function auditPresentationMaterialPixels({ root, catalog }) {
  const { createCanvas, loadImage } = await import('canvas');
  const errors = []; const images = new Map(); const facts = new Map(); const samples = new Map();
  const logicalCell = catalog.pack.logical_cell;
  const imageFor = async (asset) => {
    const file = resolveUnder(root, asset.source);
    if (!facts.has(file)) facts.set(file, await imageFacts(file));
    if (facts.get(file).sha256 !== asset.source_sha256) throw new Error(`asset source_sha256 does not match ${asset.source}`);
    if (!images.has(file)) images.set(file, await loadImage(file));
    return { image: images.get(file), facts: facts.get(file) };
  };
  const frameSample = async (reference) => {
    const [assetId, frameId = 'default'] = String(reference).split('#'); const key = `${assetId}#${frameId}`;
    if (samples.has(key)) return samples.get(key);
    const asset = catalog.assets[assetId]; const frame = asset?.frames?.[frameId];
    if (!asset || !frame) throw new Error(`unknown material pixel reference ${key}`);
    const loaded = await imageFor(asset); const [sx, sy, sw, sh] = frameRect(asset, frame, loaded.facts);
    const canvas = createCanvas(logicalCell[0], logicalCell[1]); const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    context.drawImage(loaded.image, sx, sy, sw, sh, 0, 0, logicalCell[0], logicalCell[1]);
    const sample = context.getImageData(0, 0, logicalCell[0], logicalCell[1]).data; samples.set(key, sample); return sample;
  };
  const materialSample = async (material) => {
    if (material.fill.asset) return frameSample(`${material.fill.asset}#${material.fill.frame ?? 'default'}`);
    const match = material.fill.color.match(/^#(..)(..)(..)$/); const rgba = [1, 2, 3].map((index) => Number.parseInt(match[index], 16));
    const sample = new Uint8ClampedArray(logicalCell[0] * logicalCell[1] * 4);
    for (let index = 0; index < sample.length; index += 4) { sample[index] = rgba[0]; sample[index + 1] = rgba[1]; sample[index + 2] = rgba[2]; sample[index + 3] = 255; }
    return sample;
  };
  let solid = 0; let overlays = 0;
  for (const [id, material] of Object.entries(catalog.materials)) {
    const mode = material.fill_mode ?? 'solid'; const pixels = await materialSample(material);
    let visible = 0; let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) { if (pixels[index]) visible += 1; if (pixels[index] === 255) opaque += 1; }
    const total = pixels.length / 4;
    if (mode === 'solid') { solid += 1; if (opaque !== total) errors.push(`material ${id}: solid fill has ${total - opaque} transparent or translucent pixels`); }
    else { overlays += 1; if (!visible || opaque === total) errors.push(`material ${id}: overlay fill must contain both visible and transparent pixels`); }
  }
  const directionMasks = { north: 'esw', east: 'nsw', south: 'new', west: 'nes' }; const transitionBands = {}; const interfaceSeams = {}; const cornerProfiles = {};
  for (const [id, entry] of Object.entries(catalog.terrain_interfaces ?? {})) {
    const minimumChangedRatio = entry.transition_band?.minimum_changed_ratio ?? 0.1;
    const assetId = String(entry.asset).split('#')[0]; const asset = catalog.assets[assetId]; const mapping = asset.autotile[entry.polarity]; const outside = await materialSample(catalog.materials[entry.outside]); const ratios = {};
    const underlayFill = entry.underlay === 'inside-fill' ? await materialSample(catalog.materials[entry.inside]) : entry.underlay === 'outside-fill' ? outside : null; const seamRatios = {};
    for (const [direction, mask] of Object.entries(directionMasks)) {
      const frameId = mapping[mask] ?? mapping.fallback; const sampled = await frameSample(`${assetId}#${frameId}`); const inside = underlayFill ? new Uint8ClampedArray(sampled.length) : sampled;
      if (underlayFill) for (let index = 0; index < sampled.length; index += 4) {
        const alpha = sampled[index + 3] / 255; const inverse = 1 - alpha;
        inside[index] = Math.round(sampled[index] * alpha + underlayFill[index] * inverse);
        inside[index + 1] = Math.round(sampled[index + 1] * alpha + underlayFill[index + 1] * inverse);
        inside[index + 2] = Math.round(sampled[index + 2] * alpha + underlayFill[index + 2] * inverse);
        inside[index + 3] = 255;
      }
      let changed = 0; let total = 0;
      for (let y = 0; y < logicalCell[1]; y += 1) for (let x = 0; x < logicalCell[0]; x += 1) {
        const inBand = direction === 'north' ? y < logicalCell[1] / 2 : direction === 'south' ? y >= logicalCell[1] / 2 : direction === 'west' ? x < logicalCell[0] / 2 : x >= logicalCell[0] / 2;
        if (!inBand) continue; total += 1; const index = (y * logicalCell[0] + x) * 4;
        if (inside[index] !== outside[index] || inside[index + 1] !== outside[index + 1] || inside[index + 2] !== outside[index + 2] || inside[index + 3] !== outside[index + 3]) changed += 1;
      }
      ratios[direction] = changed / total;
      if (ratios[direction] < minimumChangedRatio) errors.push(`terrain interface ${id}: ${direction} transition band changes only ${ratios[direction].toFixed(3)} of boundary pixels; requires ${minimumChangedRatio}`);
      let mismatched = 0;
      for (let offset = 0; offset < (direction === 'north' || direction === 'south' ? logicalCell[0] : logicalCell[1]); offset += 1) {
        // Compare against the receiving material at the same tile-local phase.
        // Textured fills may intentionally have different opposite edges; an
        // interface must preserve what that material would paint in this cell,
        // not repair (or be blamed for) the fill's own tiling contract.
        const [insideX, insideY] = direction === 'north' ? [offset, 0]
          : direction === 'east' ? [logicalCell[0] - 1, offset]
            : direction === 'south' ? [offset, logicalCell[1] - 1] : [0, offset];
        const [outsideX, outsideY] = [insideX, insideY];
        const insideIndex = (insideY * logicalCell[0] + insideX) * 4; const outsideIndex = (outsideY * logicalCell[0] + outsideX) * 4;
        if (inside[insideIndex] !== outside[outsideIndex] || inside[insideIndex + 1] !== outside[outsideIndex + 1] || inside[insideIndex + 2] !== outside[outsideIndex + 2] || inside[insideIndex + 3] !== outside[outsideIndex + 3]) mismatched += 1;
      }
      seamRatios[direction] = mismatched / (direction === 'north' || direction === 'south' ? logicalCell[0] : logicalCell[1]);
      const maximumMismatchRatio = entry.seam?.maximum_mismatch_ratio ?? (entry.seam?.mode === 'outlined' ? 1 : 0);
      if (seamRatios[direction] > maximumMismatchRatio) errors.push(`terrain interface ${id}: ${direction} receiving seam mismatches ${seamRatios[direction].toFixed(3)} of edge pixels; allows ${maximumMismatchRatio}`);
    }
    transitionBands[id] = ratios; interfaceSeams[id] = seamRatios;
  }
  // A cardinal mask names present neighbours, so its convex cutback is in the
  // opposite (missing-neighbour) quadrant: ne cuts southwest, es northwest,
  // sw northeast, and nw southeast.
  const convexCorners = { ne: [0, logicalCell[1] / 2], es: [0, 0], sw: [logicalCell[0] / 2, 0], nw: [logicalCell[0] / 2, logicalCell[1] / 2] };
  for (const [id, entry] of Object.entries(catalog.terrain_interfaces ?? {})) {
    if (!entry.corner_profile) continue;
    const assetId = String(entry.asset).split('#')[0]; const asset = catalog.assets[assetId]; const mapping = asset.autotile[entry.polarity];
    const centerId = mapping.nesw ?? mapping.fallback; const center = await frameSample(`${assetId}#${centerId}`); const ratios = {};
    for (const [mask, [left, top]] of Object.entries(convexCorners)) {
      const frameId = mapping[mask] ?? mapping.fallback; const turn = await frameSample(`${assetId}#${frameId}`); let changed = 0; let total = 0;
      for (let y = top; y < top + logicalCell[1] / 2; y += 1) for (let x = left; x < left + logicalCell[0] / 2; x += 1) {
        total += 1; const index = (y * logicalCell[0] + x) * 4;
        if (turn[index] !== center[index] || turn[index + 1] !== center[index + 1] || turn[index + 2] !== center[index + 2] || turn[index + 3] !== center[index + 3]) changed += 1;
      }
      ratios[mask] = changed / total;
      if (ratios[mask] < entry.corner_profile.minimum_cutback_ratio) errors.push(`terrain interface ${id}: ${mask} convex turn cuts back only ${ratios[mask].toFixed(3)} of its interior quadrant; requires ${entry.corner_profile.minimum_cutback_ratio}`);
    }
    cornerProfiles[id] = ratios;
  }
  return { valid: errors.length === 0, errors, materials: Object.keys(catalog.materials).length, solid, overlays, transition_bands: transitionBands, interface_seams: interfaceSeams, corner_profiles: cornerProfiles };
}

/** Render a strict Presentation V2 scene. */
export async function renderScene({ root, catalogPath, manifestPath = null, sceneData = null, out }) {
  const scene = sceneData ?? (YAML.parse(await readFile(manifestPath, 'utf8')) ?? {});
  if (scene.schema_version !== 2 || scene.kind !== 'top-down-scene') throw new Error('scene must use Presentation V2');
  const catalog = await loadAssetCatalog(catalogPath);
  const plan = compileTopDownScene(catalog, scene);
  return renderPresentationPlan({ root, catalog, plan, out });
}

/** Explain the concrete layers selected by a prefab's typed parameters. */
/** Render a production-review bundle: full scene, thumbnail, and 2x quadrants. */
export async function renderSceneQa({ root, catalogPath, manifestPath, outDir }) {
  await mkdir(outDir, { recursive: true });
  const full = path.join(outDir, 'scene.png');
  const report = await renderScene({ root, catalogPath, manifestPath, out: full });
  const { loadImage } = await import('canvas');
  const source = await loadImage(full);
  const outputs = { full };
  const renderCrop = async (name, sx, sy, sw, sh, dw, dh) => {
    const file = path.join(outDir, `${name}.png`);
    const { canvas, ctx } = await createPixelCanvas(dw, dh);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
    await writeFile(file, canvas.toBuffer('image/png'));
    outputs[name] = file;
  };
  const halfWidth = Math.floor(source.width / 2); const halfHeight = Math.floor(source.height / 2);
  await renderCrop('thumbnail', 0, 0, source.width, source.height, Math.ceil(source.width / 2), Math.ceil(source.height / 2));
  await renderCrop('quadrant-nw', 0, 0, halfWidth, halfHeight, halfWidth * 2, halfHeight * 2);
  await renderCrop('quadrant-ne', halfWidth, 0, source.width - halfWidth, halfHeight, (source.width - halfWidth) * 2, halfHeight * 2);
  await renderCrop('quadrant-sw', 0, halfHeight, halfWidth, source.height - halfHeight, halfWidth * 2, (source.height - halfHeight) * 2);
  await renderCrop('quadrant-se', halfWidth, halfHeight, source.width - halfWidth, source.height - halfHeight, (source.width - halfWidth) * 2, (source.height - halfHeight) * 2);
  const scene = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  if (scene.review_regions !== undefined && !Array.isArray(scene.review_regions)) throw new Error('scene review_regions must be an array');
  for (const [index, region] of (scene.review_regions ?? []).entries()) {
    if (!validId(region?.id) || !Array.isArray(region.rect) || region.rect.length !== 4 || region.rect.some((value) => !Number.isFinite(value) || value < 0) || region.rect[2] < 1 || region.rect[3] < 1) throw new Error(`scene review region ${index} needs id and [x, y, width, height] rect`);
    const sceneScale = scene.schema_version === 2 ? scene.pixel_scale : 1;
    const [sx, sy, sw, sh] = region.rect.map((value) => value * sceneScale); const scale = region.scale ?? 2;
    if (!Number.isInteger(scale) || scale < 1 || sx + sw > source.width || sy + sh > source.height) throw new Error(`scene review region ${region.id} exceeds viewport or has invalid scale`);
    await renderCrop(`review-${region.id}`, sx, sy, sw, sh, sw * scale, sh * scale);
  }
  return { ...report, out_dir: outDir, outputs };
}

async function renderArtifactDiff({ approved, actual, out }) {
  const { createCanvas, loadImage } = await import('canvas'); const [approvedImage, actualImage] = await Promise.all([loadImage(approved), loadImage(actual)]);
  const width = Math.max(approvedImage.width, actualImage.width); const height = Math.max(approvedImage.height, actualImage.height);
  const sample = (image) => { const canvas = createCanvas(width, height); const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, width, height); };
  const approvedPixels = sample(approvedImage); const actualPixels = sample(actualImage); const canvas = createCanvas(width, height); const context = canvas.getContext('2d'); const output = context.createImageData(width, height); let changedPixels = 0;
  for (let index = 0; index < output.data.length; index += 4) {
    const changed = approvedPixels.data[index] !== actualPixels.data[index] || approvedPixels.data[index + 1] !== actualPixels.data[index + 1] || approvedPixels.data[index + 2] !== actualPixels.data[index + 2] || approvedPixels.data[index + 3] !== actualPixels.data[index + 3];
    if (changed) { changedPixels += 1; output.data[index] = 255; output.data[index + 1] = actualPixels.data[index + 1] * 0.2; output.data[index + 2] = actualPixels.data[index + 2] * 0.2; output.data[index + 3] = 255; }
    else { const luminance = Math.round(actualPixels.data[index] * 0.2126 + actualPixels.data[index + 1] * 0.7152 + actualPixels.data[index + 2] * 0.0722); output.data[index] = luminance; output.data[index + 1] = luminance; output.data[index + 2] = luminance; output.data[index + 3] = Math.min(96, actualPixels.data[index + 3]); }
  }
  context.putImageData(output, 0, 0); await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, dimensions: { approved: [approvedImage.width, approvedImage.height], actual: [actualImage.width, actualImage.height] }, changed_pixels: changedPixels, changed_ratio: changedPixels / (width * height) };
}

async function compareApprovedArtifacts({ suitePath, suite, outDir, artifactHashes }) {
  if (!suite.baseline) return null;
  if (typeof suite.baseline !== 'string' || !suite.baseline.trim() || path.isAbsolute(suite.baseline)) throw new Error('scene QA set baseline must be a relative path');
  const baselinePath = path.resolve(path.dirname(suitePath), suite.baseline); const baseline = YAML.parse(await readFile(baselinePath, 'utf8'), { uniqueKeys: true }) ?? {};
  if (baseline.schema_version !== 1 || baseline.kind !== 'presentation-artifact-baseline') throw new Error('scene QA baseline must be a presentation-artifact-baseline v1');
  if (typeof baseline.artifacts_root !== 'string' || !baseline.artifacts_root.trim() || path.isAbsolute(baseline.artifacts_root)) throw new Error('scene QA baseline artifacts_root must be relative');
  if (!baseline.artifacts || typeof baseline.artifacts !== 'object' || Array.isArray(baseline.artifacts)) throw new Error('scene QA baseline artifacts must be a map');
  const approvedRoot = path.resolve(path.dirname(baselinePath), baseline.artifacts_root); const expectedKeys = Object.keys(baseline.artifacts).sort(); const actualKeys = Object.keys(artifactHashes).sort();
  const missing = expectedKeys.filter((key) => !Object.hasOwn(artifactHashes, key)); const unexpected = actualKeys.filter((key) => !Object.hasOwn(baseline.artifacts, key)); const changed = []; const diffs = [];
  for (const key of expectedKeys) {
    if (!/^[a-f0-9]{64}$/.test(String(baseline.artifacts[key]))) throw new Error(`scene QA baseline ${key} has an invalid sha256`);
    const approvedFile = resolveUnder(approvedRoot, key); const approvedHash = await sha256File(approvedFile);
    if (approvedHash !== baseline.artifacts[key]) throw new Error(`scene QA baseline artifact is corrupt: ${key}`);
    if (!Object.hasOwn(artifactHashes, key) || artifactHashes[key] === approvedHash) continue;
    changed.push(key); const actualFile = resolveUnder(outDir, key); const diffFile = resolveUnder(path.join(outDir, 'diffs'), key);
    diffs.push({ artifact: key, ...(await renderArtifactDiff({ approved: approvedFile, actual: actualFile, out: diffFile })) });
  }
  return { valid: !missing.length && !unexpected.length && !changed.length, baseline: baselinePath, approved_root: approvedRoot, expected: expectedKeys.length, actual: actualKeys.length, missing, unexpected, changed, diffs };
}

/** Explicitly copy a completed QA report into an independent approved baseline. */
export async function approveSceneQaBaseline({ manifestPath, reportPath, artifactsDir }) {
  const suitePath = path.resolve(manifestPath); const suite = YAML.parse(await readFile(suitePath, 'utf8'), { uniqueKeys: true }) ?? {};
  if (typeof suite.baseline !== 'string' || !suite.baseline.trim() || path.isAbsolute(suite.baseline)) throw new Error('scene QA approval requires a relative suite baseline path');
  const report = YAML.parse(await readFile(reportPath, 'utf8'), { uniqueKeys: true }) ?? {}; const hashes = report.artifact_sha256;
  if (!report.valid || !hashes || typeof hashes !== 'object' || Array.isArray(hashes) || !Object.keys(hashes).length) throw new Error('scene QA approval requires a valid completed report with artifact hashes');
  const sourceRoot = path.dirname(path.resolve(reportPath)); const destinationRoot = path.resolve(artifactsDir); await mkdir(destinationRoot, { recursive: true });
  for (const [key, hash] of Object.entries(hashes)) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error(`scene QA report ${key} has an invalid sha256`);
    const source = resolveUnder(sourceRoot, key); if (await sha256File(source) !== hash) throw new Error(`scene QA report artifact changed after rendering: ${key}`);
    const destination = resolveUnder(destinationRoot, key); await ensureParent(destination); await copyFile(source, destination);
  }
  const baselinePath = path.resolve(path.dirname(suitePath), suite.baseline); const baseline = { schema_version: 1, kind: 'presentation-artifact-baseline', suite_manifest: path.basename(suitePath), artifacts_root: posixRelative(path.dirname(baselinePath), destinationRoot), artifact_count: Object.keys(hashes).length, artifacts: Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right))) };
  await writeYaml(baselinePath, baseline); return { valid: true, baseline: baselinePath, artifacts_root: destinationRoot, artifacts: baseline.artifact_count };
}

/** Render and gate a named collection of semantic scenes as one regression suite. */
export async function renderSceneQaSet({ root, manifestPath, outDir, candidate = false }) {
  if (typeof candidate !== 'boolean') throw new Error('scene QA set candidate must be boolean');
  const suitePath = path.resolve(manifestPath);
  const suite = YAML.parse(await readFile(suitePath, 'utf8'), { uniqueKeys: true }) ?? {};
  if (suite.schema_version !== 2 || suite.kind !== 'presentation-scene-qa-set') throw new Error('scene QA set requires Presentation V2');
  if (typeof suite.catalog !== 'string' || !suite.catalog.trim() || path.isAbsolute(suite.catalog)) throw new Error('scene QA set catalog must be a relative path');
  if (!Array.isArray(suite.scenes) || !suite.scenes.length) throw new Error('scene QA set scenes must be a non-empty array');
  const suiteDir = path.dirname(suitePath); const catalogPath = path.resolve(suiteDir, suite.catalog);
  const requirements = suite.requirements ?? {};
  assertKnownFields(requirements, new Set(['minimum_scenes', 'minimum_semantic_scenes', 'minimum_review_regions_per_scene', 'minimum_inside_corners_resolved', 'minimum_connections', 'minimum_boundary_draws', 'minimum_validated_landings', 'minimum_validated_crossings', 'required_themes', 'require_review_regions', 'require_no_clipping', 'require_catalog_warning_free', 'require_deterministic_plan', 'require_approved_artifacts', 'required_systems']), 'scene QA set requirements');
  const minimumScenes = requirements.minimum_scenes ?? 1;
  if (!Number.isInteger(minimumScenes) || minimumScenes < 1) throw new Error('scene QA set minimum_scenes must be a positive integer');
  if (suite.scenes.length < minimumScenes) throw new Error(`scene QA set requires at least ${minimumScenes} scenes; found ${suite.scenes.length}`);
  const minimumSemanticScenes = requirements.minimum_semantic_scenes ?? 0;
  if (!Number.isInteger(minimumSemanticScenes) || minimumSemanticScenes < 0) throw new Error('scene QA set minimum_semantic_scenes must be a non-negative integer');
  const minimumReviewRegions = requirements.minimum_review_regions_per_scene ?? (requirements.require_review_regions ? 1 : 0);
  if (!Number.isInteger(minimumReviewRegions) || minimumReviewRegions < 0) throw new Error('scene QA set minimum_review_regions_per_scene must be a non-negative integer');
  for (const field of ['minimum_inside_corners_resolved', 'minimum_connections', 'minimum_boundary_draws', 'minimum_validated_landings', 'minimum_validated_crossings']) if (requirements[field] !== undefined && (!Number.isInteger(requirements[field]) || requirements[field] < 0)) throw new Error(`scene QA set ${field} must be a non-negative integer`);
  for (const field of ['required_themes', 'required_systems']) if (requirements[field] !== undefined && (!Array.isArray(requirements[field]) || requirements[field].some((entry) => typeof entry !== 'string' || !entry.trim()))) throw new Error(`scene QA set ${field} must be an array of names`);
  for (const field of ['require_review_regions', 'require_no_clipping', 'require_catalog_warning_free', 'require_deterministic_plan', 'require_approved_artifacts']) if (requirements[field] !== undefined && typeof requirements[field] !== 'boolean') throw new Error(`scene QA set ${field} must be boolean`);
  if (requirements.require_approved_artifacts && !suite.baseline) throw new Error('scene QA set requires a baseline path when require_approved_artifacts is true');
  const presentationCatalog = await loadAssetCatalog(catalogPath);
  const validation = { ...validatePresentationCatalog(presentationCatalog), warnings: [] };
  if (!validation.valid) throw new Error(`scene QA set catalog is invalid: ${validation.errors.join('; ')}`);
  const materialPixelAudit = await auditPresentationMaterialPixels({ root, catalog: presentationCatalog });
  if (materialPixelAudit && !materialPixelAudit.valid) throw new Error(`scene QA set material pixel audit failed: ${materialPixelAudit.errors.join('; ')}`);
  if (requirements.require_catalog_warning_free && validation.warnings.length) throw new Error(`scene QA set catalog has warnings: ${validation.warnings.join('; ')}`);
  const ids = new Set(); const themes = new Set(); const reports = [];
  // QA output is fully generated. Recreate the bundle so removed or renamed
  // scenes cannot survive as stale directories beside the current report.
  await rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await mkdir(outDir, { recursive: true });
  for (const [index, entry] of suite.scenes.entries()) {
    assertKnownFields(entry, new Set(['id', 'theme', 'manifest']), `scene QA set scene ${index}`);
    if (!validId(entry?.id) || ids.has(entry.id)) throw new Error(`scene QA set scene ${index} needs a unique id`);
    if (typeof entry.theme !== 'string' || !entry.theme.trim()) throw new Error(`scene QA set scene ${entry.id} needs a theme`);
    if (typeof entry.manifest !== 'string' || !entry.manifest.trim() || path.isAbsolute(entry.manifest)) throw new Error(`scene QA set scene ${entry.id} manifest must be a relative path`);
    ids.add(entry.id); themes.add(entry.theme);
    const scenePath = path.resolve(suiteDir, entry.manifest); const scene = YAML.parse(await readFile(scenePath, 'utf8'), { uniqueKeys: true }) ?? {};
    if (minimumReviewRegions && (!Array.isArray(scene.review_regions) || scene.review_regions.length < minimumReviewRegions)) throw new Error(`scene QA set scene ${entry.id} needs at least ${minimumReviewRegions} review_regions`);
    const report = await renderSceneQa({ root, catalogPath, manifestPath: scenePath, outDir: path.join(outDir, entry.id) });
    if (requirements.require_no_clipping && report.clipping.length) throw new Error(`scene QA set scene ${entry.id} has ${report.clipping.length} clipped draws`);
    if (requirements.require_deterministic_plan) {
      const secondPlan = compileTopDownScene(await loadAssetCatalog(catalogPath), scene);
      if (secondPlan.hash !== report.plan_hash) throw new Error(`scene QA set scene ${entry.id} produced a non-deterministic plan hash`);
    }
    reports.push({ id: entry.id, theme: entry.theme, manifest: entry.manifest, semantic_layout: Boolean(scene.composition), ...report });
  }
  const semanticSceneCount = reports.filter((report) => report.semantic_layout).length;
  if (semanticSceneCount < minimumSemanticScenes) throw new Error(`scene QA set requires at least ${minimumSemanticScenes} semantic composition scenes; found ${semanticSceneCount}`);
  const missingThemes = (requirements.required_themes ?? []).filter((theme) => !themes.has(theme));
  if (missingThemes.length) throw new Error(`scene QA set is missing required themes: ${missingThemes.join(', ')}`);
  const systemCounts = {
    terrain: reports.reduce((sum, report) => sum + report.diagnostics.systems.terrain, 0),
    connector: reports.reduce((sum, report) => sum + report.diagnostics.systems.connector, 0),
    height: reports.reduce((sum, report) => sum + report.diagnostics.systems.height, 0),
    component: reports.reduce((sum, report) => sum + report.diagnostics.systems.component, 0),
    shadow: reports.reduce((sum, report) => sum + report.diagnostics.systems.shadow, 0),
  };
  const missingSystems = (requirements.required_systems ?? []).filter((system) => !Object.hasOwn(systemCounts, system) || systemCounts[system] < 1);
  if (missingSystems.length) throw new Error(`scene QA set did not exercise required systems: ${missingSystems.join(', ')}`);
  const boundaryDraws = systemCounts.terrain;
  if (boundaryDraws < (requirements.minimum_boundary_draws ?? 0)) throw new Error(`scene QA set requires ${requirements.minimum_boundary_draws} boundary draws; found ${boundaryDraws}`);
  const { createCanvas, loadImage } = await import('canvas');
  const cardWidth = 320; const imageHeight = 192; const labelHeight = 24; const columns = 2; const rows = Math.ceil(reports.length / columns);
  const montage = createCanvas(cardWidth * columns, (imageHeight + labelHeight) * rows); const context = montage.getContext('2d');
  context.imageSmoothingEnabled = false; context.fillStyle = '#111827'; context.fillRect(0, 0, montage.width, montage.height); context.font = '13px monospace'; context.textBaseline = 'middle';
  for (const [index, report] of reports.entries()) {
    const x = (index % columns) * cardWidth; const y = Math.floor(index / columns) * (imageHeight + labelHeight); const source = await loadImage(report.outputs.full);
    context.drawImage(source, 0, 0, source.width, source.height, x, y, cardWidth, imageHeight);
    context.fillStyle = '#111827'; context.fillRect(x, y + imageHeight, cardWidth, labelHeight); context.fillStyle = '#f9fafb'; context.fillText(`${report.id} · ${report.theme}`, x + 8, y + imageHeight + labelHeight / 2);
  }
  const montagePath = path.join(outDir, 'montage.png'); await writeFile(montagePath, montage.toBuffer('image/png'));
  const reviewEntries = reports.flatMap((report) => Object.entries(report.outputs).filter(([name]) => name.startsWith('review-')).map(([name, file]) => ({ scene: report.id, name: name.slice('review-'.length), file })));
  const reviewCardWidth = 320; const reviewImageHeight = 176; const reviewColumns = 3; const reviewRows = Math.ceil(reviewEntries.length / reviewColumns);
  const reviewMontage = createCanvas(reviewCardWidth * reviewColumns, (reviewImageHeight + labelHeight) * reviewRows); const reviewContext = reviewMontage.getContext('2d');
  reviewContext.imageSmoothingEnabled = false; reviewContext.fillStyle = '#111827'; reviewContext.fillRect(0, 0, reviewMontage.width, reviewMontage.height); reviewContext.font = '12px monospace'; reviewContext.textBaseline = 'middle';
  for (const [index, entry] of reviewEntries.entries()) {
    const x = (index % reviewColumns) * reviewCardWidth; const y = Math.floor(index / reviewColumns) * (reviewImageHeight + labelHeight); const source = await loadImage(entry.file);
    const scale = Math.min(reviewCardWidth / source.width, reviewImageHeight / source.height); const width = Math.max(1, Math.floor(source.width * scale)); const height = Math.max(1, Math.floor(source.height * scale)); const left = x + Math.floor((reviewCardWidth - width) / 2); const top = y + Math.floor((reviewImageHeight - height) / 2);
    reviewContext.drawImage(source, 0, 0, source.width, source.height, left, top, width, height);
    reviewContext.fillStyle = '#111827'; reviewContext.fillRect(x, y + reviewImageHeight, reviewCardWidth, labelHeight); reviewContext.fillStyle = '#f9fafb'; reviewContext.fillText(`${entry.scene} · ${entry.name}`, x + 8, y + reviewImageHeight + labelHeight / 2);
  }
  const reviewMontagePath = path.join(outDir, 'review-montage.png'); await writeFile(reviewMontagePath, reviewMontage.toBuffer('image/png'));
  const summary = {
    valid: true, scenes: reports.length, semantic_scenes: semanticSceneCount, themes: [...themes], systems: systemCounts,
    draws: reports.reduce((sum, report) => sum + report.draws, 0),
    inside_corners_resolved: reports.reduce((sum, report) => sum + report.diagnostics.inside_corners_resolved, 0),
    connections: reports.reduce((sum, report) => sum + report.diagnostics.connections, 0),
    validated_landings: reports.reduce((sum, report) => sum + report.diagnostics.landings.length, 0),
    validated_crossings: reports.reduce((sum, report) => sum + report.diagnostics.crossings.length, 0),
    clipping: reports.reduce((sum, report) => sum + report.clipping.length, 0),
    composition: {
      minimum_navigation_connectivity: Math.min(...reports.map((report) => report.diagnostics.composition.navigation_connectivity)),
      minimum_occupied_sectors: Math.min(...reports.map((report) => report.diagnostics.composition.occupied_sectors)),
      visual_coverage: {
        minimum: Math.min(...reports.map((report) => report.diagnostics.composition.visual_coverage)),
        maximum: Math.max(...reports.map((report) => report.diagnostics.composition.visual_coverage)),
      },
      maximum_repeat_ratio: Math.max(...reports.map((report) => report.diagnostics.composition.repeat_ratio)),
      minimum_role_diversity: Math.min(...reports.map((report) => report.diagnostics.composition.role_diversity)),
      maximum_role_dominance: Math.max(...reports.map((report) => report.diagnostics.composition.role_dominance)),
    },
    resolution: {
      strict_v2_scenes: reports.length,
      non_uniform_scale_draws: 0,
      normalized_draws: reports.reduce((sum, report) => sum + report.draws - report.diagnostics.shadows, 0),
    },
    material_pixel_audit: materialPixelAudit ?? undefined,
    catalog_warnings: validation.warnings,
  };
  if (summary.inside_corners_resolved < (requirements.minimum_inside_corners_resolved ?? 0)) throw new Error(`scene QA set requires at least ${requirements.minimum_inside_corners_resolved} resolved inside corners; found ${summary.inside_corners_resolved}`);
  if (summary.connections < (requirements.minimum_connections ?? 0)) throw new Error(`scene QA set requires at least ${requirements.minimum_connections} connections; found ${summary.connections}`);
  if (summary.validated_landings < (requirements.minimum_validated_landings ?? 0)) throw new Error(`scene QA set requires at least ${requirements.minimum_validated_landings} validated landings; found ${summary.validated_landings}`);
  if (summary.validated_crossings < (requirements.minimum_validated_crossings ?? 0)) throw new Error(`scene QA set requires at least ${requirements.minimum_validated_crossings} validated crossings; found ${summary.validated_crossings}`);
  const artifactFiles = [...new Set([montagePath, reviewMontagePath, ...reports.flatMap((report) => Object.values(report.outputs))])];
  const artifactHashes = Object.fromEntries(await Promise.all(artifactFiles.map(async (file) => [posixRelative(outDir, file), await sha256File(file)])));
  const visualRegression = candidate
    ? { valid: true, candidate: true, baseline: suite.baseline ? path.resolve(suiteDir, suite.baseline) : null }
    : await compareApprovedArtifacts({ suitePath, suite, outDir, artifactHashes });
  const result = { ...summary, valid: visualRegression?.valid ?? true, approval_candidate: candidate, review_regions: reviewEntries.length, artifact_count: artifactFiles.length, artifact_sha256: artifactHashes, visual_regression: visualRegression, out_dir: outDir, montage: montagePath, review_montage: reviewMontagePath, reports };
  await writeYaml(path.join(outDir, 'report.yml'), result);
  if (visualRegression && !visualRegression.valid) throw new Error(`scene QA visual regression failed: ${visualRegression.changed.length} changed, ${visualRegression.missing.length} missing, ${visualRegression.unexpected.length} unexpected artifacts; inspect ${path.join(outDir, 'diffs')}`);
  return result;
}

function cellsForTerrainQa(mask, missingCorners = []) {
  const cells = new Set(['1,1']);
  const directions = mask === 'isolated' ? '' : mask;
  const cardinal = { n: [1, 0], e: [2, 1], s: [1, 2], w: [0, 1] };
  for (const direction of ['n', 'e', 's', 'w']) if (directions.includes(direction)) cells.add(cardinal[direction].join(','));
  const diagonals = { nw: [0, 0], ne: [2, 0], se: [2, 2], sw: [0, 2] };
  const requiredByCardinals = {
    nw: directions.includes('n') && directions.includes('w'), ne: directions.includes('n') && directions.includes('e'),
    se: directions.includes('s') && directions.includes('e'), sw: directions.includes('s') && directions.includes('w'),
  };
  for (const [corner, at] of Object.entries(diagonals)) if (requiredByCardinals[corner] && !missingCorners.includes(corner)) cells.add(at.join(','));
  return cells;
}

async function renderTerrainTopologyQaAsset({ root, catalog, assetId, out, scale }) {
  const asset = catalog.assets?.[assetId];
  if (!asset || asset.status !== 'approved' || !asset.autotile) throw new Error(`topology QA requires an approved autotile asset: ${assetId}`);
  const polarities = ['positive', 'negative'].filter((polarity) => asset.autotile[polarity]);
  const cases = [];
  for (const polarity of polarities) {
    const masks = Object.keys(asset.autotile[polarity]).filter((mask) => mask !== 'fallback').sort();
    for (const mask of masks) cases.push({ id: `${polarity}.${mask}`, polarity, cells: cellsForTerrainQa(mask), at: [1, 1] });
    if (asset.autotile.topology !== 'cardinal-4+diagonal-corners') continue;
    const cornerMap = asset.autotile.inner_corners?.[polarity] ?? asset.autotile.inner_corners;
    if (asset.autotile.inner_corner_mode === 'composite') {
      const corners = ['nw', 'ne', 'se', 'sw'];
      for (let bits = 1; bits < 16; bits += 1) {
        const missing = corners.filter((corner, index) => bits & (1 << index));
        cases.push({ id: `${polarity}.inner.${missing.join('-')}`, polarity, cells: cellsForTerrainQa('nesw', missing), at: [1, 1] });
      }
    } else for (const key of Object.keys(cornerMap ?? {}).sort()) {
      const missing = key.split('-');
      cases.push({ id: `${polarity}.inner.${key}`, polarity, cells: cellsForTerrainQa('nesw', missing), at: [1, 1] });
    }
    if (asset.autotile.animation) for (let phase = 1; phase < asset.autotile.animation.frames; phase += 1) {
      cases.push({ id: `${polarity}.animation.${phase}`, polarity, phase, cells: cellsForTerrainQa('nesw'), at: [1, 1] });
    }
  }
  if (!cases.length) throw new Error(`topology QA found no declared cases: ${assetId}`);
  const sourceFile = resolveUnder(root, asset.source); const sourceFacts = await imageFacts(sourceFile);
  const { loadImage } = await import('canvas'); const sourceImage = await loadImage(sourceFile);
  const columns = Math.min(8, cases.length); const cardWidth = Math.max(112, 16 * scale + 24); const cardHeight = 16 * scale + 58;
  const rows = Math.ceil(cases.length / columns); const { canvas, ctx } = await createPixelCanvas(columns * cardWidth, rows * cardHeight);
  ctx.fillStyle = '#171923'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '11px monospace'; ctx.textBaseline = 'top';
  const reportCases = [];
  for (const [index, qaCase] of cases.entries()) {
    const column = index % columns; const row = Math.floor(index / columns); const left = column * cardWidth; const top = row * cardHeight;
    const resolved = resolveTerrainFrame({ cells: qaCase.cells, at: qaCase.at, frames: asset.autotile, polarity: qaCase.polarity, phase: qaCase.phase ?? 0 });
    ctx.fillStyle = index % 2 ? '#202735' : '#242c3a'; ctx.fillRect(left, top, cardWidth, cardHeight);
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) {
      ctx.fillStyle = qaCase.cells.has(`${x},${y}`) ? '#68d391' : '#4a5568'; ctx.fillRect(left + 6 + x * 7, top + 6 + y * 7, 6, 6);
    }
    const tileX = left + Math.floor((cardWidth - 16 * scale) / 2); const tileY = top + 28;
    for (const frameName of resolved.layers) {
      const frame = asset.frames?.[frameName];
      if (!frame) throw new Error(`topology QA resolved unknown frame: ${frameName}`);
      const [sx, sy, sw, sh] = frameRect(asset, frame, sourceFacts, resolved.frame_offset);
      if (sw !== 16 || sh !== 16) throw new Error(`topology QA requires normalized 16x16 frames: ${assetId}#${frameName}`);
      ctx.drawImage(sourceImage, sx, sy, sw, sh, tileX, tileY, 16 * scale, 16 * scale);
    }
    ctx.fillStyle = '#f7fafc'; ctx.fillText(qaCase.id, left + 4, top + cardHeight - 25, cardWidth - 8);
    ctx.fillStyle = '#a0aec0'; ctx.fillText(resolved.layers.join('+'), left + 4, top + cardHeight - 13, cardWidth - 8);
    reportCases.push({ id: qaCase.id, mask: resolved.mask, inner_corners: resolved.inner_corners, phase: resolved.phase, frame_offset: resolved.frame_offset, layers: resolved.layers });
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, asset: assetId, cases: reportCases.length, polarities, compound_inner_cases: reportCases.filter((entry) => entry.inner_corners.length > 1).length, details: reportCases };
}

/** Render every declared mask and inside-corner combination as labeled unit evidence. */
export async function renderTerrainTopologyQa({ root, catalogPath, assetId, out, scale = 4 }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('topology QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath);
  const validation = await validateCatalogForQa({ root, catalogPath, catalog });
  if (!validation.valid) throw new Error(`invalid asset catalog: ${validation.errors.join('; ')}`);
  return renderTerrainTopologyQaAsset({ root, catalog, assetId, out, scale });
}

/** Render topology evidence for every approved autotile in one validated catalog. */
export async function renderTerrainTopologyQaSet({ root, catalogPath, outDir, scale = 4 }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('topology QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath);
  const validation = await validateCatalogForQa({ root, catalogPath, catalog });
  if (!validation.valid) throw new Error(`invalid asset catalog: ${validation.errors.join('; ')}`);
  const assetIds = Object.entries(catalog.assets ?? {})
    .filter(([, asset]) => asset?.status === 'approved' && asset?.autotile)
    .map(([id]) => id)
    .sort();
  if (!assetIds.length) throw new Error('topology QA set found no approved autotiles');
  const outputs = {};
  for (const assetId of assetIds) {
    const out = path.join(outDir, `${assetId}.png`);
    const report = await renderTerrainTopologyQaAsset({ root, catalog, assetId, out, scale });
    outputs[assetId] = { out, cases: report.cases, polarities: report.polarities, compound_inner_cases: report.compound_inner_cases };
  }
  const result = { valid: true, catalog: catalogPath, out_dir: outDir, assets: assetIds.length, cases: Object.values(outputs).reduce((sum, entry) => sum + entry.cases, 0), compound_inner_cases: Object.values(outputs).reduce((sum, entry) => sum + entry.compound_inner_cases, 0), outputs };
  await writeYaml(path.join(outDir, 'report.yml'), result);
  return result;
}

/** Render every declared connector branch mask with its transformed port points. */
export async function renderConnectorQa({ root, catalogPath, assetId, out, scale = 3 }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('connector QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath);
  const validation = await validateCatalogForQa({ root, catalogPath, catalog });
  if (!validation.valid) throw new Error(`invalid asset catalog: ${validation.errors.join('; ')}`);
  const asset = catalog.assets?.[assetId];
  if (!asset?.connector || asset.status !== 'approved') throw new Error(`connector QA requires an approved connector asset: ${assetId}`);
  const file = resolveUnder(root, asset.source); const facts = await imageFacts(file); const { loadImage } = await import('canvas'); const source = await loadImage(file);
  const cases = Object.keys(asset.connector.pieces).sort().map((mask) => resolveConnectorFrame(asset, mask === 'isolated' ? [] : mask.split('')));
  const measured = cases.map((entry) => {
    const frameId = entry.frame; const frame = asset.frames[frameId]; const rect = frameRect(asset, frame, facts);
    return { ...entry, frameId, frame, rect, width: rect[2] * scale, height: rect[3] * scale };
  });
  const cardWidth = Math.max(128, ...measured.map((entry) => entry.width + 24)); const cardHeight = Math.max(96, ...measured.map((entry) => entry.height + 44));
  const columns = Math.min(4, cases.length); const rows = Math.ceil(cases.length / columns); const { canvas, ctx } = await createPixelCanvas(columns * cardWidth, rows * cardHeight);
  ctx.fillStyle = '#171923'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '12px monospace'; ctx.textBaseline = 'top';
  const details = [];
  for (const [index, entry] of measured.entries()) {
    const left = (index % columns) * cardWidth; const top = Math.floor(index / columns) * cardHeight;
    ctx.fillStyle = index % 2 ? '#202735' : '#242c3a'; ctx.fillRect(left, top, cardWidth, cardHeight);
    const [sx, sy, sw, sh] = entry.rect; const dx = left + Math.floor((cardWidth - entry.width) / 2); const dy = top + 18;
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, entry.width, entry.height);
    for (const [port, point] of Object.entries(entry.frame.ports ?? {})) {
      const px = dx + point[0] * scale; const py = dy + point[1] * scale;
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(port, Math.min(px + 5, left + cardWidth - 42), Math.max(top + 2, py - 13));
    }
    ctx.fillStyle = '#fff'; ctx.fillText(`${entry.mask} · ${entry.frameId}`, left + 5, top + cardHeight - 19);
    details.push({ mask: entry.mask, frame: entry.frameId, ports: Object.keys(entry.frame.ports ?? {}) });
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, asset: assetId, cases: details.length, details };
}

export async function renderConnectorQaSet({ root, catalogPath, outDir, scale = 3 }) {
  const catalog = await loadAssetCatalog(catalogPath);
  const assetIds = Object.entries(catalog.assets ?? {}).filter(([, asset]) => asset?.status === 'approved' && asset?.connector).map(([id]) => id).sort();
  if (!assetIds.length) throw new Error('connector QA set found no approved connectors');
  const outputs = {};
  for (const assetId of assetIds) {
    const report = await renderConnectorQa({ root, catalogPath, assetId, out: path.join(outDir, `${assetId}.png`), scale });
    outputs[assetId] = { out: report.out, cases: report.cases };
  }
  const result = { valid: true, catalog: catalogPath, assets: assetIds.length, cases: Object.values(outputs).reduce((sum, entry) => sum + entry.cases, 0), out_dir: outDir, outputs };
  await writeYaml(path.join(outDir, 'report.yml'), result);
  return result;
}

export async function renderHeightQa({ root, catalogPath, assetId, out, scale = 4 }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('height QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath);
  const validation = await validateCatalogForQa({ root, catalogPath, catalog });
  if (!validation.valid) throw new Error(`invalid asset catalog: ${validation.errors.join('; ')}`);
  const asset = catalog.assets?.[assetId];
  if (!asset?.height || asset.status !== 'approved') throw new Error(`height QA requires an approved height asset: ${assetId}`);
  const file = resolveUnder(root, asset.source); const facts = await imageFacts(file); const { loadImage } = await import('canvas'); const source = await loadImage(file);
  const transitions = Object.keys(asset.height.transitions).sort().map((direction) => resolveHeightTransition(asset, direction));
  const cell = asset.geometry.cell; const widthCells = 3; const maxBands = Math.max(...transitions.map((transition) => transition.bands.length));
  const cardWidth = widthCells * cell[0] * scale + 32; const cardHeight = maxBands * cell[1] * scale + 50;
  const { canvas, ctx } = await createPixelCanvas(cardWidth * transitions.length, cardHeight);
  ctx.fillStyle = '#171923'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '12px monospace'; ctx.textBaseline = 'top';
  for (const [transitionIndex, transition] of transitions.entries()) {
    const left = transitionIndex * cardWidth; ctx.fillStyle = transitionIndex % 2 ? '#202735' : '#242c3a'; ctx.fillRect(left, 0, cardWidth, cardHeight);
    for (const [bandIndex, band] of transition.bands.entries()) for (const [partIndex, frameName] of band.frames.entries()) {
      const frame = asset.frames[frameName]; const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
      const dx = left + 16 + partIndex * cell[0] * scale; const dy = 18 + bandIndex * cell[1] * scale;
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, cell[0] * scale, cell[1] * scale);
    }
    ctx.fillStyle = '#fff'; ctx.fillText(`${transition.direction} · rise ${transition.rise_cells}`, left + 8, cardHeight - 27);
    ctx.fillStyle = '#a0aec0'; ctx.fillText(transition.bands.map((band) => band.id).join(' > '), left + 8, cardHeight - 14);
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, asset: assetId, transitions: transitions.map((transition) => ({ direction: transition.direction, rise_cells: transition.rise_cells, bands: transition.bands.map((band) => band.id) })) };
}

export async function renderHeightQaSet({ root, catalogPath, outDir, scale = 4 }) {
  const catalog = await loadAssetCatalog(catalogPath);
  const assetIds = Object.entries(catalog.assets ?? {}).filter(([, asset]) => asset?.status === 'approved' && asset?.height).map(([id]) => id).sort();
  if (!assetIds.length) throw new Error('height QA set found no approved height assets');
  const outputs = {};
  for (const assetId of assetIds) {
    const report = await renderHeightQa({ root, catalogPath, assetId, out: path.join(outDir, `${assetId}.png`), scale });
    outputs[assetId] = { out: report.out, transitions: report.transitions.length };
  }
  const result = { valid: true, catalog: catalogPath, assets: assetIds.length, transitions: Object.values(outputs).reduce((sum, entry) => sum + entry.transitions, 0), out_dir: outDir, outputs };
  await writeYaml(path.join(outDir, 'report.yml'), result);
  return result;
}

export async function renderComponentQa({ root, catalogPath, assetId, out, scale = 3 }) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('component QA scale must be a positive integer');
  const catalog = await loadAssetCatalog(catalogPath); const validation = await validateCatalogForQa({ root, catalogPath, catalog });
  if (!validation.valid) throw new Error(`invalid asset catalog: ${validation.errors.join('; ')}`);
  const asset = catalog.assets?.[assetId]; if (!asset?.components || asset.status !== 'approved') throw new Error(`component QA requires an approved component asset: ${assetId}`);
  const file = resolveUnder(root, asset.source); const facts = await imageFacts(file); const { loadImage } = await import('canvas'); const source = await loadImage(file);
  const entries = Object.entries(asset.components).flatMap(([componentId, component]) => component.frames.map((frameName) => ({ componentId, role: component.role, frameName, frame: asset.frames[frameName] })));
  const cell = asset.geometry.cell ?? [32, 32]; const cardWidth = cell[0] * scale + 32; const cardHeight = cell[1] * scale + 44; const columns = Math.min(8, entries.length); const rows = Math.ceil(entries.length / columns);
  const { canvas, ctx } = await createPixelCanvas(columns * cardWidth, rows * cardHeight); ctx.fillStyle = '#171923'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '11px monospace'; ctx.textBaseline = 'top';
  for (const [index, entry] of entries.entries()) {
    const left = index % columns * cardWidth; const top = Math.floor(index / columns) * cardHeight; ctx.fillStyle = index % 2 ? '#202735' : '#242c3a'; ctx.fillRect(left, top, cardWidth, cardHeight);
    const [sx, sy, sw, sh] = frameRect(asset, entry.frame, facts); const ratio = Math.min(cell[0] * scale / sw, cell[1] * scale / sh); const width = sw * ratio; const height = sh * ratio;
    ctx.drawImage(source, sx, sy, sw, sh, left + (cardWidth - width) / 2, top + 8, width, height); ctx.fillStyle = '#fff'; ctx.fillText(`${entry.role}.${entry.componentId}`, left + 4, top + cardHeight - 26); ctx.fillStyle = '#a0aec0'; ctx.fillText(entry.frameName, left + 4, top + cardHeight - 14);
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, asset: assetId, components: Object.keys(asset.components).length, frames: entries.length };
}

/** Render all approved component atlases so every named unit has visual evidence. */
export async function renderComponentQaSet({ root, catalogPath, outDir, scale = 3 }) {
  const catalog = await loadAssetCatalog(catalogPath);
  const assetIds = Object.entries(catalog.assets ?? {}).filter(([, asset]) => asset?.status === 'approved' && asset?.components).map(([id]) => id).sort();
  if (!assetIds.length) throw new Error('component QA set found no approved component assets');
  const outputs = {};
  for (const assetId of assetIds) {
    const report = await renderComponentQa({ root, catalogPath, assetId, out: path.join(outDir, `${assetId}.png`), scale });
    outputs[assetId] = { out: report.out, components: report.components, frames: report.frames };
  }
  const result = {
    valid: true,
    catalog: catalogPath,
    assets: assetIds.length,
    components: Object.values(outputs).reduce((sum, entry) => sum + entry.components, 0),
    frames: Object.values(outputs).reduce((sum, entry) => sum + entry.frames, 0),
    out_dir: outDir,
    outputs,
  };
  await writeYaml(path.join(outDir, 'report.yml'), result);
  return result;
}

export async function explainPrefab({ catalogPath, id, params = {} }) {
  const catalog = await loadAssetCatalog(catalogPath);
  const validation = validatePrefabCatalog(catalog);
  if (validation.length) throw new Error(`invalid prefab catalog: ${validation.join('; ')}`);
  const resolved = resolvePrefabLayers(catalog, id, params);
  return { id, params: resolved.params, layers: resolved.layers };
}

/** Build a reproducible derived atlas from explicitly recorded source crops. */
export async function deriveAtlas({ root, recipePath, out }) {
  const recipe = YAML.parse(await readFile(recipePath, 'utf8')) ?? {};
  if (!validPair(recipe.canvas) || !Array.isArray(recipe.layers)) throw new Error('recipe needs canvas and layers');
  const { createCanvas, loadImage } = await import('canvas');
  const { canvas, ctx } = await createPixelCanvas(...recipe.canvas);
  for (const [index, layer] of recipe.layers.entries()) {
    if (!validCoordinate(layer?.at) || !Array.isArray(layer?.rect) || layer.rect.length !== 4) throw new Error(`recipe layer ${index} needs at and rect`);
    if (layer.size !== undefined && !validPair(layer.size)) throw new Error(`recipe layer ${index} size must be [width, height]`);
    const file = resolveUnder(root, layer.source); const image = await loadImage(file);
    const [sx, sy, sw, sh] = layer.rect;
    if (![sx, sy, sw, sh].every(Number.isInteger) || sw < 1 || sh < 1 || sx < 0 || sy < 0 || sx + sw > image.width || sy + sh > image.height) throw new Error(`recipe layer ${index} rect exceeds source`);
    const [dw, dh] = layer.size ?? [sw, sh];
    if (layer.at[0] + dw > canvas.width || layer.at[1] + dh > canvas.height) throw new Error(`recipe layer ${index} exceeds canvas`);
    ctx.drawImage(image, sx, sy, sw, sh, layer.at[0], layer.at[1], dw, dh);
  }
  const colorMap = recipe.color_map ?? {};
  if (!colorMap || typeof colorMap !== 'object' || Array.isArray(colorMap)
    || Object.entries(colorMap).some(([from, to]) => !/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to))) throw new Error('recipe color_map must map #rrggbb colors to #rrggbb colors');
  if (Object.keys(colorMap).length) {
    const replacements = new Map(Object.entries(colorMap).map(([from, to]) => [from.slice(1).toLowerCase(), to.slice(1).toLowerCase()]));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index + 3] === 0) continue;
      const key = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
      const replacement = replacements.get(key); if (!replacement) continue;
      pixels.data[index] = Number.parseInt(replacement.slice(0, 2), 16);
      pixels.data[index + 1] = Number.parseInt(replacement.slice(2, 4), 16);
      pixels.data[index + 2] = Number.parseInt(replacement.slice(4, 6), 16);
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const textureFills = recipe.texture_fills ?? [];
  if (!Array.isArray(textureFills)) throw new Error('recipe texture_fills must be an array');
  for (const [fillIndex, fill] of textureFills.entries()) {
    if (!fill?.source || !Array.isArray(fill.rect) || fill.rect.length !== 4) throw new Error(`recipe texture_fill ${fillIndex} needs source and rect`);
    if (!Array.isArray(fill.colors) || !fill.colors.length || fill.colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) throw new Error(`recipe texture_fill ${fillIndex} colors must contain #rrggbb values`);
    const origin = fill.origin ?? [0, 0];
    if (!validCoordinate(origin)) throw new Error(`recipe texture_fill ${fillIndex} origin must be a non-negative pair`);
    const file = resolveUnder(root, fill.source); const image = await loadImage(file); const [sx, sy, sw, sh] = fill.rect;
    if (![sx, sy, sw, sh].every(Number.isInteger) || sw < 1 || sh < 1 || sx < 0 || sy < 0 || sx + sw > image.width || sy + sh > image.height) throw new Error(`recipe texture_fill ${fillIndex} rect exceeds source`);
    const textureCanvas = createCanvas(sw, sh); const textureContext = textureCanvas.getContext('2d'); textureContext.imageSmoothingEnabled = false;
    textureContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh); const texture = textureContext.getImageData(0, 0, sw, sh).data;
    const keyed = new Set(fill.colors.map((color) => color.slice(1).toLowerCase())); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      if (!pixels.data[index + 3]) continue;
      const rgb = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (!keyed.has(rgb)) continue;
      const textureX = ((x - origin[0]) % sw + sw) % sw; const textureY = ((y - origin[1]) % sh + sh) % sh; const textureIndex = (textureY * sw + textureX) * 4;
      pixels.data.set(texture.subarray(textureIndex, textureIndex + 4), index);
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const transparentColors = recipe.transparent_colors ?? [];
  if (!Array.isArray(transparentColors) || transparentColors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('recipe transparent_colors must contain #rrggbb values');
  if (transparentColors.length) {
    const keyed = new Set(transparentColors.map((color) => color.slice(1).toLowerCase()));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const rgb = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (keyed.has(rgb)) pixels.data[index + 3] = 0;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, canvas: recipe.canvas, layers: recipe.layers.length, transparent_colors: transparentColors, color_map: Object.keys(colorMap).length, texture_fills: textureFills.length };
}

const BLOB_CARDINAL_MASKS = ['isolated', 'n', 'e', 's', 'w', 'ne', 'ns', 'nw', 'es', 'ew', 'sw', 'nes', 'new', 'nsw', 'esw', 'nesw'];

/**
 * Normalize a classic 3x3 outer-border source into all 16 cardinal masks and
 * four transparent diagonal-notch overlays. Quarter composition preserves the
 * source palette while making thin routes and compound concavities possible.
 */
async function buildBlobRecipe({ root, recipe }) {
  if (typeof recipe.source !== 'string' || !validPair(recipe.cell) || recipe.cell[0] % 2 || recipe.cell[1] % 2 || !validCoordinate(recipe.outer_origin)) {
    throw new Error('blob recipe needs source, even-sized cell, and outer_origin cell coordinates');
  }
  const inner = recipe.inner ?? { layout: 'inverse-outer' };
  const topology = recipe.topology ?? 'cardinal-4+diagonal-corners';
  if (!['cardinal-4', 'cardinal-4+diagonal-corners'].includes(topology)) throw new Error('blob recipe topology must be cardinal-4 or cardinal-4+diagonal-corners');
  if (!['two-by-two', 'inverse-outer'].includes(inner.layout) || (inner.layout === 'two-by-two' && !validCoordinate(inner.origin))) {
    throw new Error('blob recipe inner layout must be two-by-two with origin or inverse-outer');
  }
  const { loadImage } = await import('canvas'); const file = resolveUnder(root, recipe.source); const image = await loadImage(file);
  const [cellWidth, cellHeight] = recipe.cell; const halfWidth = cellWidth / 2; const halfHeight = cellHeight / 2;
  const [outerX, outerY] = recipe.outer_origin;
  const outerStride = recipe.outer_stride ?? [1, 1];
  if (!validPair(outerStride)) throw new Error('blob recipe outer_stride must be positive cell steps');
  const outerCornerMode = recipe.outer_corner_mode ?? 'quarter-composite';
  if (!['quarter-composite', 'native'].includes(outerCornerMode)) throw new Error('blob recipe outer_corner_mode must be quarter-composite or native');
  const outerEdgeMode = recipe.outer_edge_mode ?? 'quarter-composite';
  if (!['quarter-composite', 'native'].includes(outerEdgeMode)) throw new Error('blob recipe outer_edge_mode must be quarter-composite or native');
  const outerCornerStyle = recipe.outer_corner_style ?? 'square';
  if (!['square', 'rounded'].includes(outerCornerStyle)) throw new Error('blob recipe outer_corner_style must be square or rounded');
  const sourceCell = (cellX, cellY, quadrantX, quadrantY) => [
    cellX * cellWidth + quadrantX * halfWidth,
    cellY * cellHeight + quadrantY * halfHeight,
    halfWidth, halfHeight,
  ];
  if ((outerX + outerStride[0] * 2 + 1) * cellWidth > image.width || (outerY + outerStride[1] * 2 + 1) * cellHeight > image.height) throw new Error('blob recipe outer 3x3 exceeds source');
  const negativeOuter = recipe.negative_outer_origin;
  if (negativeOuter !== undefined && !validCoordinate(negativeOuter)) throw new Error('negative_outer_origin must be cell coordinates');
  const hasNegative = recipe.negative !== false && (inner.layout === 'two-by-two' || negativeOuter !== undefined);
  if (negativeOuter && ((negativeOuter[0] + outerStride[0] * 2 + 1) * cellWidth > image.width || (negativeOuter[1] + outerStride[1] * 2 + 1) * cellHeight > image.height)) throw new Error('blob recipe negative outer 3x3 exceeds source');
  const { canvas, ctx } = await createPixelCanvas(cellWidth * 4, cellHeight * (hasNegative ? 10 : 5));
  const quadrantRules = [
    { id: 'nw', at: [0, 0], directions: ['n', 'w'], both: [1, 1, 0, 0], first: [0, 1, 0, 0], second: [1, 0, 0, 0], neither: [0, 0, 0, 0] },
    { id: 'ne', at: [1, 0], directions: ['n', 'e'], both: [1, 1, 1, 0], first: [2, 1, 1, 0], second: [1, 0, 1, 0], neither: [2, 0, 1, 0] },
    { id: 'se', at: [1, 1], directions: ['s', 'e'], both: [1, 1, 1, 1], first: [2, 1, 1, 1], second: [1, 2, 1, 1], neither: [2, 2, 1, 1] },
    { id: 'sw', at: [0, 1], directions: ['s', 'w'], both: [1, 1, 0, 1], first: [0, 1, 0, 1], second: [1, 2, 0, 1], neither: [0, 2, 0, 1] },
  ];
  const nativeOuterCorners = { ne: [0, 2], es: [0, 0], sw: [2, 0], nw: [2, 2] };
  const nativeOuterEdges = { nes: [0, 1], esw: [1, 0], new: [1, 2], nsw: [2, 1] };
  const drawOuterBases = (origin, rowOffset) => BLOB_CARDINAL_MASKS.forEach((mask, index) => {
    const directions = mask === 'isolated' ? '' : mask; const destinationX = (index % 4) * cellWidth; const destinationY = (rowOffset + Math.floor(index / 4)) * cellHeight;
    for (const rule of quadrantRules) {
      const first = directions.includes(rule.directions[0]); const second = directions.includes(rule.directions[1]);
      const selection = first && second ? rule.both : first ? rule.first : second ? rule.second : rule.neither;
      const [sx, sy, sw, sh] = sourceCell(origin[0] + selection[0] * outerStride[0], origin[1] + selection[1] * outerStride[1], selection[2], selection[3]);
      ctx.drawImage(image, sx, sy, sw, sh, destinationX + rule.at[0] * halfWidth, destinationY + rule.at[1] * halfHeight, halfWidth, halfHeight);
    }
    // Classic 3x3 sheets often carry hand-drawn full-cell convex turns whose
    // curves and bank detail cross the quadrant seam. Quarter reconstruction
    // destroys that information and produces a mathematically correct but
    // visibly square turn. Opted-in jobs preserve the native turn verbatim.
    const nativeCorner = nativeOuterCorners[mask];
    if (outerCornerMode === 'native' && nativeCorner) {
      ctx.drawImage(image,
        (origin[0] + nativeCorner[0] * outerStride[0]) * cellWidth,
        (origin[1] + nativeCorner[1] * outerStride[1]) * cellHeight,
        cellWidth, cellHeight, destinationX, destinationY, cellWidth, cellHeight);
    }
    // The middle cells of a classic 3x3 source often contain a continuous
    // hand-drawn bank, curb, or foam run. Rebuilding those cells from corner
    // halves preserves topology but discards the source's cardinal-edge art.
    const nativeEdge = nativeOuterEdges[mask];
    if (outerEdgeMode === 'native' && nativeEdge) {
      ctx.drawImage(image,
        (origin[0] + nativeEdge[0] * outerStride[0]) * cellWidth,
        (origin[1] + nativeEdge[1] * outerStride[1]) * cellHeight,
        cellWidth, cellHeight, destinationX, destinationY, cellWidth, cellHeight);
    }
  });
  drawOuterBases([outerX, outerY], 0);
  const innerSelections = inner.layout === 'two-by-two'
    ? {
      nw: [inner.origin[0] + 1, inner.origin[1] + 1, 0, 0], ne: [inner.origin[0], inner.origin[1] + 1, 1, 0],
      se: [inner.origin[0], inner.origin[1], 1, 1], sw: [inner.origin[0] + 1, inner.origin[1], 0, 1],
    }
    : {
      nw: [outerX, outerY, 0, 0], ne: [outerX + 2 * outerStride[0], outerY, 1, 0],
      se: [outerX + 2 * outerStride[0], outerY + 2 * outerStride[1], 1, 1], sw: [outerX, outerY + 2 * outerStride[1], 0, 1],
    };
  for (const [index, corner] of ['nw', 'ne', 'se', 'sw'].entries()) {
    const selection = innerSelections[corner]; const [sx, sy, sw, sh] = sourceCell(...selection);
    const rule = quadrantRules.find((candidate) => candidate.id === corner);
    ctx.drawImage(image, sx, sy, sw, sh, index * cellWidth + rule.at[0] * halfWidth, cellHeight * 4 + rule.at[1] * halfHeight, halfWidth, halfHeight);
  }
  if (hasNegative) {
    if (negativeOuter) drawOuterBases(negativeOuter, 5);
    else {
      const [innerX, innerY] = inner.origin;
      const rawCellFor = {
        nw: (first, second) => [innerX + (second ? 1 : 0), innerY + (first ? 1 : 0)],
        ne: (first, second) => [innerX + (second ? 0 : 1), innerY + (first ? 1 : 0)],
        se: (first, second) => [innerX + (second ? 0 : 1), innerY + (first ? 0 : 1)],
        sw: (first, second) => [innerX + (second ? 1 : 0), innerY + (first ? 0 : 1)],
      };
      for (const [index, mask] of BLOB_CARDINAL_MASKS.entries()) {
        const directions = mask === 'isolated' ? '' : mask; const destinationX = (index % 4) * cellWidth; const destinationY = (5 + Math.floor(index / 4)) * cellHeight;
        for (const rule of quadrantRules) {
          const first = directions.includes(rule.directions[0]); const second = directions.includes(rule.directions[1]);
          const [cellX, cellY] = rawCellFor[rule.id](first, second);
          const [sx, sy, sw, sh] = sourceCell(cellX, cellY, rule.at[0], rule.at[1]);
          ctx.drawImage(image, sx, sy, sw, sh, destinationX + rule.at[0] * halfWidth, destinationY + rule.at[1] * halfHeight, halfWidth, halfHeight);
        }
        const nativeCorner = nativeOuterCorners[mask];
        if (outerCornerMode === 'native' && nativeCorner) {
          const nativeInnerCorners = { ne: [0, 1], es: [0, 0], sw: [1, 0], nw: [1, 1] };
          const sourceCorner = nativeInnerCorners[mask];
          ctx.drawImage(image, (innerX + sourceCorner[0]) * cellWidth, (innerY + sourceCorner[1]) * cellHeight,
            cellWidth, cellHeight, destinationX, destinationY, cellWidth, cellHeight);
        }
      }
    }
    const inverseOrigin = negativeOuter ?? [outerX, outerY];
    const negativeInnerSelections = {
      nw: [inverseOrigin[0], inverseOrigin[1], 0, 0], ne: [inverseOrigin[0] + 2 * outerStride[0], inverseOrigin[1], 1, 0],
      se: [inverseOrigin[0] + 2 * outerStride[0], inverseOrigin[1] + 2 * outerStride[1], 1, 1], sw: [inverseOrigin[0], inverseOrigin[1] + 2 * outerStride[1], 0, 1],
    };
    for (const [index, corner] of ['nw', 'ne', 'se', 'sw'].entries()) {
      const [sx, sy, sw, sh] = sourceCell(...negativeInnerSelections[corner]);
      const rule = quadrantRules.find((candidate) => candidate.id === corner);
      ctx.drawImage(image, sx, sy, sw, sh, index * cellWidth + rule.at[0] * halfWidth, cellHeight * 9 + rule.at[1] * halfHeight, halfWidth, halfHeight);
    }
  }
  const colorMap = recipe.color_map ?? {};
  if (!colorMap || typeof colorMap !== 'object' || Array.isArray(colorMap)
    || Object.entries(colorMap).some(([from, to]) => !/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to))) {
    throw new Error('blob recipe color_map must map #rrggbb colors to #rrggbb colors');
  }
  if (Object.keys(colorMap).length) {
    const replacements = new Map(Object.entries(colorMap).map(([from, to]) => [from.slice(1).toLowerCase(), to.slice(1).toLowerCase()]));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index + 3] === 0) continue;
      const key = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
      const replacement = replacements.get(key); if (!replacement) continue;
      pixels.data[index] = Number.parseInt(replacement.slice(0, 2), 16);
      pixels.data[index + 1] = Number.parseInt(replacement.slice(2, 4), 16);
      pixels.data[index + 2] = Number.parseInt(replacement.slice(4, 6), 16);
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const transparentColors = recipe.transparent_colors ?? [];
  if (!Array.isArray(transparentColors) || transparentColors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('blob recipe transparent_colors must contain #rrggbb values');
  if (transparentColors.length) {
    const keyed = new Set(transparentColors.map((color) => color.slice(1).toLowerCase()));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const key = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (keyed.has(key)) pixels.data[index + 3] = 0;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const hasInnerCorners = topology === 'cardinal-4+diagonal-corners';
  const positiveFrames = [
    ...BLOB_CARDINAL_MASKS.map((mask, index) => [`base.${mask}`, { cell: [index % 4, Math.floor(index / 4)] }]),
    ...(hasInnerCorners ? ['nw', 'ne', 'se', 'sw'].map((corner, index) => [`inner.${corner}`, { cell: [index, 4] }]) : []),
  ];
  const negativeFrames = hasNegative ? [
    ...BLOB_CARDINAL_MASKS.map((mask, index) => [`negative.base.${mask}`, { cell: [index % 4, 5 + Math.floor(index / 4)] }]),
    ...(hasInnerCorners ? ['nw', 'ne', 'se', 'sw'].map((corner, index) => [`negative.inner.${corner}`, { cell: [index, 9] }]) : []),
  ] : [];
  return { canvas, result: {
    source: recipe.source, cell: recipe.cell, grid: [4, hasNegative ? 10 : 5], transparent_colors: transparentColors,
    frames: Object.fromEntries([...positiveFrames, ...negativeFrames]),
    autotile: {
      topology,
      supported_polarities: hasNegative ? ['positive', 'negative'] : ['positive'],
      outer_corner_mode: outerCornerMode,
      outer_corner_style: outerCornerStyle,
      outer_edge_mode: outerEdgeMode,
      ...(hasInnerCorners ? { inner_corner_mode: 'composite' } : {}),
      positive: Object.fromEntries(BLOB_CARDINAL_MASKS.map((mask) => [mask, `base.${mask}`])),
      ...(hasNegative ? { negative: Object.fromEntries(BLOB_CARDINAL_MASKS.map((mask) => [mask, `negative.base.${mask}`])) } : {}),
      ...(hasInnerCorners ? { inner_corners: hasNegative ? {
          positive: Object.fromEntries(['nw', 'ne', 'se', 'sw'].map((corner) => [corner, `inner.${corner}`])),
          negative: Object.fromEntries(['nw', 'ne', 'se', 'sw'].map((corner) => [corner, `negative.inner.${corner}`])),
        } : Object.fromEntries(['nw', 'ne', 'se', 'sw'].map((corner) => [corner, `inner.${corner}`])) } : {}),
    },
  } };
}

async function renderBlobRecipe({ root, recipe, out }) {
  const { canvas, result } = await buildBlobRecipe({ root, recipe });
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, ...result };
}

async function renderAnimatedBlobRecipe({ root, recipe, out }) {
  const animation = recipe.animation;
  if (typeof animation?.source !== 'string' || !Number.isInteger(animation.frames) || animation.frames < 2 || !validCoordinate(animation.stride) || !Number.isFinite(animation.fps) || animation.fps <= 0) {
    throw new Error('blob animation needs source, frames >= 2, stride cell coordinates, and positive fps');
  }
  const phases = [];
  for (let phase = 0; phase < animation.frames; phase += 1) {
    const offset = [animation.stride[0] * phase, animation.stride[1] * phase];
    const shift = ([x, y]) => [x + offset[0], y + offset[1]];
    const phaseRecipe = {
      ...recipe,
      source: animation.source,
      outer_origin: shift(recipe.outer_origin),
      ...(recipe.negative_outer_origin ? { negative_outer_origin: shift(recipe.negative_outer_origin) } : {}),
      inner: recipe.inner?.layout === 'two-by-two' ? { ...recipe.inner, origin: shift(recipe.inner.origin) } : recipe.inner,
    };
    delete phaseRecipe.animation;
    phases.push(await buildBlobRecipe({ root, recipe: phaseRecipe }));
  }
  const phaseWidth = phases[0].canvas.width; const phaseHeight = phases[0].canvas.height;
  const { canvas, ctx } = await createPixelCanvas(phaseWidth * phases.length, phaseHeight);
  phases.forEach((phase, index) => ctx.drawImage(phase.canvas, index * phaseWidth, 0));
  const base = phases[0].result;
  const strideCells = base.grid[0];
  const result = {
    ...base,
    source: animation.source,
    grid: [base.grid[0] * animation.frames, base.grid[1]],
    autotile: {
      ...base.autotile,
      animation: { mode: 'grid-offset', frames: animation.frames, fps: animation.fps, loop: animation.loop ?? 'loop', phase_stride: [strideCells, 0] },
    },
  };
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, ...result };
}

export async function deriveBlobAutotile({ root, recipePath, out }) {
  const recipe = YAML.parse(await readFile(recipePath, 'utf8')) ?? {};
  return renderBlobRecipe({ root, recipe, out });
}

/** Generate every normalized blob atlas declared by one reproducible set. */
export async function deriveBlobAutotileSet({ root, manifestPath }) {
  const manifest = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  if (manifest.schema_version !== 1 || manifest.kind !== 'blob-autotile-derivation-set' || !manifest.jobs || typeof manifest.jobs !== 'object' || Array.isArray(manifest.jobs)) {
    throw new Error('blob derivation set needs schema_version 1, kind, and jobs map');
  }
  const outputs = {};
  for (const [id, job] of Object.entries(manifest.jobs)) {
    if (!validId(id) || typeof job?.out !== 'string' || !job.out.startsWith('assets/')) throw new Error(`invalid blob derivation job: ${id}`);
    const out = resolveUnder(root, job.out);
    const result = job.animation
      ? await renderAnimatedBlobRecipe({ root, recipe: job, out })
      : await renderBlobRecipe({ root, recipe: job, out });
    const facts = await imageFacts(out);
    outputs[id] = { ...result, out: job.out, source_sha256: facts.sha256 };
  }
  return { valid: true, jobs: Object.keys(outputs).length, outputs };
}

function blobCatalogLicense(manifest, id) {
  const namespace = id.split('.')[0];
  const scope = manifest.catalog?.license_scopes?.[namespace];
  if (!scope) throw new Error(`blob derivation job ${id} has no catalog license scope for namespace ${namespace}`);
  return scope;
}

function blobTemplateId(result) {
  const topology = result.autotile.topology === 'cardinal-4' ? 'cardinal' : 'blob';
  const animation = result.autotile.animation ? `-animated-${result.autotile.animation.frames}` : '';
  const edgesAndCorners = `-${result.autotile.outer_edge_mode}-${result.autotile.outer_corner_mode}-${result.autotile.outer_corner_style}`;
  return `${topology}-${result.cell[0]}x${result.cell[1]}-${result.autotile.negative ? 'bipolar' : 'positive'}${animation}${edgesAndCorners}`;
}

/** Generate normalized atlases and a compact, hash-pinned runtime catalog. */
export async function deriveBlobAutotileCatalog({ root, manifestPath, catalogOut }) {
  const manifest = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  if (!manifest.catalog?.pack?.id || !manifest.catalog?.license_scopes) throw new Error('blob derivation set catalog needs pack.id and license_scopes');
  const generated = await deriveBlobAutotileSet({ root, manifestPath });
  const assetTemplates = {};
  const assets = {};
  for (const [id, result] of Object.entries(generated.outputs)) {
    const templateId = blobTemplateId(result);
    assetTemplates[templateId] ??= {
      kind: 'tile-sheet',
      tags: ['terrain', 'autotile', 'derived'],
      geometry: { layout: 'grid', cell: result.cell, grid: result.grid },
      defaults: { anchor: 'top-left' },
      frames: result.frames,
      autotile: result.autotile,
    };
    const job = manifest.jobs[id];
    assets[`terrain.${id}`] = {
      extends: templateId,
      source: result.out,
      source_sha256: result.source_sha256,
      status: 'approved',
      license_scope: blobCatalogLicense(manifest, id),
      derived_from: job.source,
      derivation_job: id,
    };
  }
  const catalog = {
    schema_version: 1,
    pack: manifest.catalog.pack,
    generated_from: path.basename(manifestPath),
    asset_templates: Object.fromEntries(Object.entries(assetTemplates).sort(([a], [b]) => a.localeCompare(b))),
    assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeYaml(catalogOut, catalog);
  return { valid: true, catalog: catalogOut, jobs: generated.jobs, templates: Object.keys(assetTemplates).length, assets: Object.keys(assets).length };
}

async function renderFenceConnectorRecipe({ root, job, out }) {
  if (typeof job.source !== 'string' || !validCoordinate(job.base)) throw new Error('fence connector recipe needs source and base cell');
  const { loadImage } = await import('canvas'); const image = await loadImage(resolveUnder(root, job.source)); const cell = job.cell ?? [16, 16];
  if (!validPair(cell) || (job.base[0] + 4) * cell[0] > image.width || (job.base[1] + 4) * cell[1] > image.height) throw new Error(`fence connector source block exceeds image: ${job.source}`);
  const { canvas, ctx } = await createPixelCanvas(cell[0] * 4, cell[1] * 3);
  const drawCell = (sourceCell, destinationCell) => ctx.drawImage(image, sourceCell[0] * cell[0], sourceCell[1] * cell[1], cell[0], cell[1], destinationCell[0] * cell[0], destinationCell[1] * cell[1], cell[0], cell[1]);
  const [baseX, baseY] = job.base;
  const topCornerRowOffset = job.top_corner_row_offset ?? 0;
  if (!Number.isInteger(topCornerRowOffset) || topCornerRowOffset < 0 || topCornerRowOffset > 3) throw new Error('top_corner_row_offset is invalid');
  [[baseX + 1, baseY + topCornerRowOffset], [baseX + 3, baseY + topCornerRowOffset], [baseX + 1, baseY + 3], [baseX + 3, baseY + 3]].forEach((sourceCell, index) => drawCell(sourceCell, [index, 0]));
  const extensionRows = job.top_extension_rows ?? 2;
  if (!Number.isInteger(extensionRows) || extensionRows < 0 || extensionRows > cell[1]) throw new Error('top_extension_rows is invalid');
  if (extensionRows) for (const destinationX of [0, 1]) ctx.drawImage(
    image, baseX * cell[0], (baseY + 2) * cell[1] - extensionRows, cell[0], extensionRows,
    destinationX * cell[0], cell[1] - extensionRows, cell[0], extensionRows,
  );
  [[baseX, baseY], [baseX, baseY + 1], [baseX, baseY + 3]].forEach((sourceCell, index) => drawCell(sourceCell, [index, 1]));
  const endExtensionRows = job.end_extension_rows ?? 3;
  if (!Number.isInteger(endExtensionRows) || endExtensionRows < 0 || endExtensionRows > cell[1]) throw new Error('end_extension_rows is invalid');
  if (endExtensionRows) ctx.drawImage(
    image, baseX * cell[0], (baseY + 1) * cell[1], cell[0], endExtensionRows,
    2 * cell[0], cell[1], cell[0], endExtensionRows,
  );
  [[baseX + 1, baseY], [baseX + 2, baseY], [baseX + 3, baseY]].forEach((sourceCell, index) => drawCell(sourceCell, [index, 2]));
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, source: job.source, cell, grid: [4, 3] };
}

export async function deriveFenceConnectorCatalog({ root, manifestPath, catalogOut }) {
  const manifest = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  if (manifest.schema_version !== 1 || manifest.kind !== 'fence-connector-derivation-set' || !manifest.catalog?.pack?.id || !manifest.jobs) throw new Error('fence derivation set needs schema, kind, catalog, and jobs');
  const template = {
    status: 'approved', kind: 'tile-sheet', tags: ['structure', 'fence', 'connector', 'derived', 'topdown'],
    geometry: { layout: 'grid', cell: [16, 16], grid: [4, 3] }, defaults: { anchor: 'top-left' },
    frames: {
      'corner.nw': { cell: [0, 0], ports: { east: [16, 8], south: [8, 16] } },
      'corner.ne': { cell: [1, 0], ports: { west: [0, 8], south: [8, 16] } },
      'corner.sw': { cell: [2, 0], ports: { north: [8, 0], east: [16, 8] } },
      'corner.se': { cell: [3, 0], ports: { west: [0, 8], north: [8, 0] } },
      'vertical.start': { cell: [0, 1], ports: { south: [8, 16] } },
      'vertical.middle': { cell: [1, 1], ports: { north: [8, 0], south: [8, 16] } },
      'vertical.end': { cell: [2, 1], ports: { north: [8, 0] } },
      'horizontal.start': { cell: [0, 2], ports: { east: [16, 8] } },
      'horizontal.middle': { cell: [1, 2], ports: { west: [0, 8], east: [16, 8] } },
      'horizontal.end': { cell: [2, 2], ports: { west: [0, 8] } },
    },
    connector: { topology: 'connector-graph', pieces: { n: 'vertical.end', e: 'horizontal.start', s: 'vertical.start', w: 'horizontal.end', ne: 'corner.sw', ns: 'vertical.middle', nw: 'corner.se', es: 'corner.nw', ew: 'horizontal.middle', sw: 'corner.ne' } },
  };
  const assets = {};
  for (const [id, job] of Object.entries(manifest.jobs)) {
    if (!validId(id) || typeof job.out !== 'string' || !job.out.startsWith('assets/')) throw new Error(`invalid fence derivation job: ${id}`);
    const result = await renderFenceConnectorRecipe({ root, job, out: resolveUnder(root, job.out) }); const facts = await imageFacts(resolveUnder(root, job.out));
    assets[`connector.${id}`] = { extends: 'fence-16', source: job.out, source_sha256: facts.sha256, license_scope: job.license_scope, derived_from: job.source, derivation_job: id };
  }
  await writeYaml(catalogOut, { schema_version: 1, pack: manifest.catalog.pack, generated_from: path.basename(manifestPath), asset_templates: { 'fence-16': template }, assets });
  return { valid: true, catalog: catalogOut, assets: Object.keys(assets).length };
}
