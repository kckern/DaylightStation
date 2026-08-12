import crypto from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { resolvePrefabLayers, resolveTerrainFrame, validatePrefabCatalog } from '../../shared/gaming/assets.mjs';

const IMAGE_EXTENSIONS = new Set(['.png']);
const PNG_SIGNATURE = '89504e470d0a1a0a';
const PNG_COLOR_MODES = new Map([
  [0, 'grayscale'], [2, 'rgb'], [3, 'indexed'], [4, 'grayscale-alpha'], [6, 'rgba'],
]);
const COMMON_CELLS = [8, 16, 24, 32, 48, 64];
const STATUS = new Set(['candidate', 'approved', 'deferred', 'rejected']);
const LICENSE_SCOPE_BY_PATH = [
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
  ['Old_Sprites', 'legacy-unclassified'], ['Cute_Fantasy_MilitaryCamp', 'legacy-unclassified/military-camp'],
  ['Cute_Fantasy_ShroomLands', 'legacy-unclassified/shroom-lands'], ['Player_Aseprite_Files', 'legacy-unclassified/player-aseprite-files'],
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
    return [targetDir, 'legacy-unclassified', `${kebab(root.slice(0, -extension.length))}${extension}`].join('/');
  }
  const destinationRoot = PACK_ROOTS.get(root) ?? `legacy-unclassified/${kebab(root)}`;
  const defaultPrefixes = [
    [['Animals'], ['actors', 'animals']], [['Buildings', 'Buildings'], ['environment', 'buildings']],
    [['Crops'], ['environment', 'crops']], [['Enemies'], ['actors', 'enemies']],
    [['Icons'], ['ui', 'icons']], [['NPCs (Premade)'], ['actors', 'npcs', 'premade']],
    [['Outdoor decoration'], ['environment', 'props']], [['Player'], ['actors', 'player']],
    [['Tiles'], ['environment', 'tiles']], [['Trees'], ['environment', 'foliage']],
    [['Weather effects'], ['effects', 'weather']], [['Other'], ['legacy-unclassified', 'other']],
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

function validAnchor(value) {
  return typeof value === 'string'
    ? new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']).has(value)
    : Array.isArray(value?.point) && validCoordinate(value.point);
}

function frameRect(asset, frame, facts) {
  if (asset.geometry.layout === 'grid') {
    const [cellW, cellH] = asset.geometry.cell;
    const [column, row] = frame.cell;
    const margin = asset.geometry.margin ?? [0, 0];
    const spacing = asset.geometry.spacing ?? [0, 0];
    return [margin[0] + column * (cellW + spacing[0]), margin[1] + row * (cellH + spacing[1]), cellW, cellH];
  }
  return frame.rect;
}

/** Validate the authored, one-file catalog shape used during the audit phase. */
export async function validateManifest({ root, manifestPath }) {
  const errors = [];
  const warnings = [];
  let manifest;
  try {
    manifest = YAML.parse(await readFile(manifestPath, 'utf8')) ?? {};
  } catch (error) {
    return { valid: false, errors: [`cannot parse manifest: ${error.message}`], warnings, assets: 0 };
  }
  if (manifest.schema_version !== 1) errors.push('schema_version must be 1');
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
    const geometry = asset.geometry;
    if (!geometry || !['grid', 'freeform'].includes(geometry.layout)) { errors.push(`${prefix}: approved asset needs geometry.layout grid or freeform`); continue; }
    let grid;
    if (geometry.layout === 'grid') {
      if (!validPair(geometry.cell) || !validPair(geometry.grid)) { errors.push(`${prefix}: grid geometry needs cell and grid`); continue; }
      const margin = geometry.margin ?? [0, 0]; const spacing = geometry.spacing ?? [0, 0];
      if (!validCoordinate(margin) || !validCoordinate(spacing)) errors.push(`${prefix}: grid margin and spacing must be non-negative pairs`);
      const [cellW, cellH] = geometry.cell; const [columns, rows] = geometry.grid;
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
      if (frame?.anchor && !validAnchor(frame.anchor)) errors.push(`${prefix}: frame ${frameName} has invalid anchor`);
      if (frame?.opaque_overlay !== undefined && typeof frame.opaque_overlay !== 'boolean') errors.push(`${prefix}: frame ${frameName} opaque_overlay must be boolean`);
      const frameShapeValid = (hasCell && geometry.layout === 'grid' && validFrame(frame.cell, grid))
        || (hasRect && geometry.layout === 'freeform' && frame.rect.length === 4 && frame.rect.every(Number.isInteger) && frame.rect[2] > 0 && frame.rect[3] > 0 && frame.rect[0] + frame.rect[2] <= facts.image.width && frame.rect[1] + frame.rect[3] <= facts.image.height);
      if (frameShapeValid && frame.anchor?.point) {
        const [, , frameWidth, frameHeight] = frameRect(asset, frame, facts);
        if (frame.anchor.point[0] > frameWidth || frame.anchor.point[1] > frameHeight) errors.push(`${prefix}: frame ${frameName} custom anchor exceeds frame bounds`);
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
          }
        }
      } else if (asset.tags.includes('actor')) warnings.push(`${prefix}: frame ${frameName} content_bounds is missing for actor scale review`);
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
        let found = null;
        for (let index = 0; index < pixels.length; index += 4) {
          if (!pixels[index + 3]) continue;
          const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('');
          if (forbiddenRgb.has(rgb)) { found = `#${rgb}`; break; }
        }
        if (found) errors.push(`${prefix}: frame ${frameName} contains forbidden color ${found}`);
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
      if (asset.autotile?.topology !== undefined && asset.autotile.topology !== 'cardinal-4') errors.push(`${prefix}: autotile topology must be cardinal-4`);
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
    }
  }
  errors.push(...validatePrefabCatalog(manifest));
  return { valid: errors.length === 0, errors, warnings, assets: Object.keys(manifest.assets).length };
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
  const catalog = catalogPath ? (YAML.parse(await readFile(catalogPath, 'utf8')) ?? {}) : {};
  const reviewBySource = new Map(Object.entries(catalog.assets ?? {}).map(([id, asset]) => [asset.source, { id, status: asset.status ?? 'unreviewed' }]));
  const thumb = 96 * scale;
  const label = 48;
  const rows = Math.ceil(files.length / columns);
  const { loadImage } = await import('canvas');
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
  const frame = asset.frames?.[inlineFrame ?? frameName];
  if (!frame) throw new Error(`asset ${assetId} has no frame: ${inlineFrame ?? frameName}`);
  return { asset, frame };
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

/** Render semantic scene YAML using approved catalog asset IDs and prefab layers. */
export async function renderScene({ root, catalogPath, manifestPath = null, sceneData = null, out }) {
  const catalog = YAML.parse(await readFile(catalogPath, 'utf8')) ?? {};
  const scene = sceneData ?? (YAML.parse(await readFile(manifestPath, 'utf8')) ?? {});
  if (!validPair(scene.viewport)) throw new Error('scene viewport must be [width, height]');
  const worldScale = scene.world_scale ?? 1;
  if (!Number.isFinite(worldScale) || worldScale <= 0) throw new Error('scene world_scale must be positive');
  const { createCanvas, loadImage } = await import('canvas');
  const [width, height] = scene.viewport; const { canvas, ctx } = await createPixelCanvas(width, height);
  ctx.fillStyle = scene.background ?? '#000000'; ctx.fillRect(0, 0, width, height);
  const imageCache = new Map(); const alphaCache = new Map(); const drawPlan = []; const clipping = [];
  const imageFor = async (file) => {
    if (!imageCache.has(file)) imageCache.set(file, await loadImage(file));
    return imageCache.get(file);
  };
  const alphaBounds = (image, sx, sy, sw, sh, key) => {
    if (alphaCache.has(key)) return alphaCache.get(key);
    const sample = createCanvas(sw, sh); const sampleContext = sample.getContext('2d');
    sampleContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    const pixels = sampleContext.getImageData(0, 0, sw, sh).data;
    let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      if (pixels[(y * sw + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const bounds = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    alphaCache.set(key, bounds); return bounds;
  };
  const draw = async (entry) => {
    assertKnownFields(entry, new Set(['asset', 'frame', 'at', 'offset', 'scale', 'z', 'depth_sort', 'flip_x', 'rotation', 'opacity', 'shadow', 'order', 'provenance']), 'scene draw');
    if (!validCoordinate(entry.at)) throw new Error(`scene draw needs non-negative integer at: ${entry.asset}`);
    if (entry.offset !== undefined && (!Array.isArray(entry.offset) || entry.offset.length !== 2 || entry.offset.some((value) => !Number.isInteger(value)))) throw new Error(`scene draw offset must be an integer pair: ${entry.asset}`);
    if (entry.opacity !== undefined && (!Number.isFinite(entry.opacity) || entry.opacity < 0 || entry.opacity > 1)) throw new Error(`scene draw opacity must be between 0 and 1: ${entry.asset}`);
    if (entry.flip_x !== undefined && typeof entry.flip_x !== 'boolean') throw new Error(`scene draw flip_x must be boolean: ${entry.asset}`);
    const rotation = entry.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error(`scene draw rotation must be 0, 90, 180, or 270: ${entry.asset}`);
    if (rotation && entry.flip_x) throw new Error(`scene draw cannot combine rotation and flip_x: ${entry.asset}`);
    const { asset, frame } = resolveCatalogFrame(catalog, entry.asset, entry.frame);
    const file = resolveUnder(root, asset.source); const facts = await imageFacts(file);
    const [sx, sy, sw, sh] = frameRect(asset, frame, facts);
    const image = await imageFor(file); const scale = entry.scale ?? worldScale;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`scene draw scale must be positive: ${entry.asset}`);
    const [ax, ay] = anchorOffset(frame.anchor ?? asset.defaults?.anchor, sw * scale, sh * scale, scale);
    const [offsetX, offsetY] = entry.offset ?? [0, 0]; const [x, y] = entry.at;
    const dx = x + offsetX - ax; const dy = y + offsetY - ay; const dw = sw * scale; const dh = sh * scale;
    const nativeAlpha = alphaBounds(image, sx, sy, sw, sh, `${file}:${sx},${sy},${sw},${sh}`);
    let visibleBounds = null;
    if (nativeAlpha) {
      const visibleX = entry.flip_x ? sw - nativeAlpha.x - nativeAlpha.width : nativeAlpha.x;
      if (rotation) {
        const radians = rotation * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
        const left = visibleX * scale - ax; const top = nativeAlpha.y * scale - ay;
        const right = left + nativeAlpha.width * scale; const bottom = top + nativeAlpha.height * scale;
        const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([pointX, pointY]) => [x + offsetX + pointX * cosine - pointY * sine, y + offsetY + pointX * sine + pointY * cosine]);
        const xs = points.map(([pointX]) => pointX); const ys = points.map(([, pointY]) => pointY);
        visibleBounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      } else visibleBounds = { x: dx + visibleX * scale, y: dy + nativeAlpha.y * scale, width: nativeAlpha.width * scale, height: nativeAlpha.height * scale };
      if (!intersectingViewport(visibleBounds, width, height)) clipping.push({ asset: entry.asset, at: entry.at, visible_bounds: visibleBounds });
    }
    if (entry.shadow !== undefined) {
      const shadow = entry.shadow; const size = shadow?.size ?? [12, 5]; const shadowOffset = shadow?.offset ?? [0, -1];
      if (!validPair(size) || !Array.isArray(shadowOffset) || shadowOffset.length !== 2 || shadowOffset.some((value) => !Number.isInteger(value))) throw new Error(`scene draw shadow needs positive size and integer offset: ${entry.asset}`);
      const shadowOpacity = shadow.opacity ?? 0.35;
      if (!Number.isFinite(shadowOpacity) || shadowOpacity < 0 || shadowOpacity > 1) throw new Error(`scene draw shadow opacity must be between 0 and 1: ${entry.asset}`);
      ctx.save(); ctx.globalAlpha = shadowOpacity; ctx.fillStyle = shadow.color ?? '#173f2a';
      ctx.beginPath(); ctx.ellipse(x + shadowOffset[0] * scale, y + shadowOffset[1] * scale - size[1] * scale / 2, size[0] * scale / 2, size[1] * scale / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.save(); ctx.globalAlpha = entry.opacity ?? 1;
    if (rotation) { ctx.translate(x + offsetX, y + offsetY); ctx.rotate(rotation * Math.PI / 180); ctx.drawImage(image, sx, sy, sw, sh, -ax, -ay, dw, dh); }
    else if (entry.flip_x) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh); }
    else ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
    drawPlan.push({ asset: entry.asset, at: entry.at, z: entry.z ?? 0, source_rect: [sx, sy, sw, sh], alpha_bounds: nativeAlpha, visible_bounds: visibleBounds, provenance: entry.provenance ?? null });
  };
  const terrainEntries = [];
  if (scene.ground !== undefined) {
    const ground = typeof scene.ground === 'string' ? { asset: scene.ground } : scene.ground;
    assertKnownFields(ground, new Set(['asset', 'frame', 'scale', 'z']), 'scene ground');
    const { asset, frame } = resolveCatalogFrame(catalog, ground.asset, ground.frame);
    const facts = await imageFacts(resolveUnder(root, asset.source)); const [, , tileWidth, tileHeight] = frameRect(asset, frame, facts);
    const scale = ground.scale ?? worldScale;
    if (scene.world_scale !== undefined && scale !== worldScale) throw new Error('scene ground scale must match scene world_scale');
    for (let y = 0; y < height; y += tileHeight * scale) for (let x = 0; x < width; x += tileWidth * scale) {
      terrainEntries.push({ asset: ground.asset, frame: ground.frame, at: [x, y], scale, z: ground.z ?? -100, depth_sort: false, provenance: 'ground' });
    }
  }
  for (const region of scene.terrain?.regions ?? []) {
    assertKnownFields(region, new Set(['terrain', 'asset', 'polarity', 'origin', 'cell', 'scale', 'cells', 'rects', 'continues', 'opacity', 'z']), `terrain region ${region.asset ?? ''}`);
    const authoredCells = [...(region.cells ?? [])];
    for (const [index, rect] of (region.rects ?? []).entries()) {
      if (!Array.isArray(rect) || rect.length !== 4 || rect.some((value) => !Number.isInteger(value)) || rect[0] < 0 || rect[1] < 0 || rect[2] < 1 || rect[3] < 1) throw new Error(`terrain rect ${index} must be [x, y, width, height]`);
      for (let y = rect[1]; y < rect[1] + rect[3]; y += 1) for (let x = rect[0]; x < rect[0] + rect[2]; x += 1) authoredCells.push([x, y]);
    }
    const uniqueCells = [...new Map(authoredCells.map((at) => [`${at[0]},${at[1]}`, at])).values()];
    const cells = new Set(uniqueCells.map(([x, y]) => `${x},${y}`));
    const asset = catalog.assets?.[region.asset];
    if (!asset || asset.status !== 'approved') throw new Error(`terrain references unavailable asset: ${region.asset}`);
    const frames = asset.autotile;
    if (!frames) throw new Error(`terrain asset has no reviewed autotile mapping: ${region.asset}`);
    const polarity = region.polarity ?? 'positive';
    if (!['positive', 'negative'].includes(polarity)) throw new Error(`terrain region polarity must be positive or negative: ${polarity}`);
    const grid = scene.terrain?.grid ?? {};
    const cell = region.cell ?? grid.cell;
    const scale = region.scale ?? grid.scale ?? worldScale;
    if (scene.world_scale !== undefined && scale !== worldScale) throw new Error(`terrain region scale must match scene world_scale: ${region.asset}`);
    const origin = region.origin ?? grid.origin ?? [0, 0];
    if (!validPair(cell) || !Number.isFinite(scale) || scale <= 0 || !validCoordinate(origin)) throw new Error(`terrain region needs valid grid cell, scale, and origin: ${region.asset}`);
    const continues = region.continues ?? [];
    if (!Array.isArray(continues) || continues.some((direction) => !['north', 'east', 'south', 'west'].includes(direction))) throw new Error(`terrain region continues must contain north/east/south/west: ${region.asset}`);
    const touched = new Set();
    for (const [cellX, cellY] of uniqueCells) {
      const pixelX = origin[0] + cellX * cell[0] * scale; const pixelY = origin[1] + cellY * cell[1] * scale;
      if (continues.includes('west') && pixelX === 0) { cells.add(`${cellX - 1},${cellY}`); touched.add('west'); }
      if (continues.includes('east') && pixelX + cell[0] * scale === width) { cells.add(`${cellX + 1},${cellY}`); touched.add('east'); }
      if (continues.includes('north') && pixelY === 0) { cells.add(`${cellX},${cellY - 1}`); touched.add('north'); }
      if (continues.includes('south') && pixelY + cell[1] * scale === height) { cells.add(`${cellX},${cellY + 1}`); touched.add('south'); }
    }
    const missedContinuations = continues.filter((direction) => !touched.has(direction));
    if (missedContinuations.length) throw new Error(`terrain region does not touch requested continuation edges ${missedContinuations.join(', ')}: ${region.asset}`);
    for (const at of uniqueCells) {
      const resolved = resolveTerrainFrame({ cells, at, frames, polarity });
      const variants = asset.autotile?.variations?.[resolved.frame];
      const variantIndex = variants ? Math.abs(at[0] * 73856093 + at[1] * 19349663) % variants.length : 0;
      const variant = variants?.[variantIndex] ?? {};
      terrainEntries.push({ asset: region.asset, frame: variant.frame ?? resolved.frame, flip_x: variant.flip_x, opacity: region.opacity, at: [origin[0] + at[0] * cell[0] * scale, origin[1] + at[1] * cell[1] * scale], scale, z: region.z ?? 0, depth_sort: false, provenance: `terrain:${region.terrain ?? region.asset}` });
    }
  }
  const concreteEntries = [...terrainEntries, ...(scene.tiles ?? [])];
  const expandPrefab = (placement, stack = []) => {
    if (stack.includes(placement.prefab)) throw new Error(`prefab cycle: ${[...stack, placement.prefab].join(' -> ')}`);
    const { layers } = resolvePrefabLayers(catalog, placement.prefab, placement.params ?? {});
    const parentScale = placement.scale ?? worldScale; const parentZ = placement.z ?? 0;
    for (const layer of layers) {
      const offset = layer.at ?? layer.offset ?? [0, 0];
      const entry = {
        ...layer,
        at: [placement.at[0] + offset[0] * parentScale, placement.at[1] + offset[1] * parentScale],
        scale: parentScale * (layer.scale ?? 1),
        z: parentZ + (layer.z ?? 0),
        depth_sort: placement.depth_sort ?? layer.depth_sort,
        shadow: layer.shadow ?? placement.shadow,
        rotation: layer.rotation ?? placement.rotation,
        provenance: [...stack, placement.prefab].join(' > '),
      };
      if (entry.prefab) expandPrefab(entry, [...stack, placement.prefab]);
      else concreteEntries.push(entry);
    }
  };
  for (const placement of scene.placements ?? []) {
    assertKnownFields(placement, new Set(['asset', 'frame', 'prefab', 'params', 'at', 'offset', 'scale', 'z', 'depth_sort', 'flip_x', 'rotation', 'opacity', 'shadow']), 'scene placement');
    if (placement.prefab) expandPrefab(placement);
    else concreteEntries.push({ ...placement, provenance: 'placement' });
  }
  const ordered = concreteEntries.map((entry, order) => ({ ...entry, order })).sort((a, b) => {
    const aDepth = a.depth_sort ?? scene.depth_sort === 'y' ? a.at[1] / 10000 : 0;
    const bDepth = b.depth_sort ?? scene.depth_sort === 'y' ? b.at[1] / 10000 : 0;
    return (a.z ?? 0) + aDepth - ((b.z ?? 0) + bDepth) || a.order - b.order;
  });
  for (const entry of ordered) await draw(entry);
  if (clipping.length && scene.fail_on_clipping !== false) throw new Error(`scene has ${clipping.length} visibly clipped draws: ${clipping.slice(0, 5).map((item) => item.asset).join(', ')}`);
  await ensureParent(out); await writeFile(out, canvas.toBuffer('image/png'));
  return { out, width, height, tiles: terrainEntries.length + (scene.tiles?.length ?? 0), placements: scene.placements?.length ?? 0, draws: drawPlan.length, clipping, trace: scene.trace ? drawPlan : undefined };
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
    if (!validId(region?.id) || !Array.isArray(region.rect) || region.rect.length !== 4 || region.rect.some((value) => !Number.isInteger(value) || value < 0) || region.rect[2] < 1 || region.rect[3] < 1) throw new Error(`scene review region ${index} needs id and [x, y, width, height] rect`);
    const [sx, sy, sw, sh] = region.rect; const scale = region.scale ?? 2;
    if (!Number.isInteger(scale) || scale < 1 || sx + sw > source.width || sy + sh > source.height) throw new Error(`scene review region ${region.id} exceeds viewport or has invalid scale`);
    await renderCrop(`review-${region.id}`, sx, sy, sw, sh, sw * scale, sh * scale);
  }
  return { ...report, out_dir: outDir, outputs };
}

export async function explainPrefab({ catalogPath, id, params = {} }) {
  const catalog = YAML.parse(await readFile(catalogPath, 'utf8')) ?? {};
  const validation = validatePrefabCatalog(catalog);
  if (validation.length) throw new Error(`invalid prefab catalog: ${validation.join('; ')}`);
  const resolved = resolvePrefabLayers(catalog, id, params);
  return { id, params: resolved.params, layers: resolved.layers };
}

/** Render one prefab in isolation through the same catalog-aware scene renderer. */
export async function renderPrefabPreview({ root, catalogPath, id, params = {}, out, viewport = [320, 240], scale = 1, background = '#171923' }) {
  if (!validPair(viewport) || !Number.isFinite(scale) || scale <= 0) throw new Error('prefab preview needs a valid viewport and scale');
  await explainPrefab({ catalogPath, id, params });
  return renderScene({
    root, catalogPath, sceneData: {
      viewport, background,
      placements: [{ prefab: id, params, at: [Math.floor(viewport[0] / 2), viewport[1] - 16], scale }],
    }, out,
  });
}

/** Build a reproducible derived atlas from explicitly recorded source crops. */
export async function deriveAtlas({ root, recipePath, out }) {
  const recipe = YAML.parse(await readFile(recipePath, 'utf8')) ?? {};
  if (!validPair(recipe.canvas) || !Array.isArray(recipe.layers)) throw new Error('recipe needs canvas and layers');
  const { loadImage } = await import('canvas');
  const { canvas, ctx } = await createPixelCanvas(...recipe.canvas);
  for (const [index, layer] of recipe.layers.entries()) {
    if (!validCoordinate(layer?.at) || !Array.isArray(layer?.rect) || layer.rect.length !== 4) throw new Error(`recipe layer ${index} needs at and rect`);
    const file = resolveUnder(root, layer.source); const image = await loadImage(file);
    const [sx, sy, sw, sh] = layer.rect;
    if (![sx, sy, sw, sh].every(Number.isInteger) || sw < 1 || sh < 1 || sx < 0 || sy < 0 || sx + sw > image.width || sy + sh > image.height) throw new Error(`recipe layer ${index} rect exceeds source`);
    ctx.drawImage(image, sx, sy, sw, sh, layer.at[0], layer.at[1], sw, sh);
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
  return { out, canvas: recipe.canvas, layers: recipe.layers.length, transparent_colors: transparentColors };
}
