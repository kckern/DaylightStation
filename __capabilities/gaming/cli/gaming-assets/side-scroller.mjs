// Side-scroller layer for the gaming-assets library.
//
// Adds what top-down catalogs never needed: slicing hand-packed ripper sheets
// into frames, parallax-layer and terrain-strip conventions with seam checks,
// and skins — a game publishes a slot contract, a skin fills those slots with
// catalog assets, and the exporter compiles the skin into the files the game
// loads. Placeholder art is gated by `distribution` so private-only sources can
// never reach a shippable build.

import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export const DISTRIBUTIONS = Object.freeze(['private-only', 'shippable']);
const SLOT_TYPES = new Set(['parallax-layers', 'texture', 'strip', 'sprite']);
const ID = /^[a-z0-9][a-z0-9._-]*$/;

async function canvasModule() { return import('canvas'); }

async function decode(file) {
  const { createCanvas, loadImage } = await canvasModule();
  const image = await loadImage(file);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// ── slice ───────────────────────────────────────────────────────────────────

/** The sheet's background: real transparency, or the commonest border colour. */
export function detectKey({ width, height, pixels }) {
  let transparent = 0;
  const counts = new Map();
  const visit = (x, y) => {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] === 0) { transparent += 1; return; }
    const k = hex(pixels[i], pixels[i + 1], pixels[i + 2]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < width; x += 1) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y += 1) { visit(0, y); visit(width - 1, y); }
  const [color, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return transparent >= count ? { type: 'alpha' } : { type: 'color', color };
}

/** Key = { type: 'alpha' } or { type: 'color', color, extra?: [colors] }. Fully transparent pixels are always background. */
function foregroundMask({ width, height, pixels }, key) {
  const mask = new Uint8Array(width * height);
  const keys = key.type === 'color' ? [key.color, ...(key.extra ?? [])] : [...(key.extra ?? [])];
  const rgb = new Set(keys.map((c) => parseInt(c.slice(1), 16)));
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    if (pixels[i + 3] === 0) continue;
    if (rgb.has((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])) continue;
    mask[p] = 1;
  }
  return mask;
}

/** '#009e00,#ff00ff' → key; first colour is the primary. */
export function parseKey(value) {
  if (!value) return null;
  const colors = String(value).split(',').map((c) => c.trim().toLowerCase());
  if (colors.some((c) => !/^#[0-9a-f]{6}$/.test(c))) throw new Error(`key colours must be #rrggbb: ${value}`);
  return { type: 'color', color: colors[0], extra: colors.slice(1) };
}

function components(mask, width, height) {
  const label = new Int32Array(width * height).fill(-1);
  const boxes = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] !== -1) continue;
    const id = boxes.length;
    const box = { x0: width, y0: height, x1: -1, y1: -1, pixels: 0 };
    label[start] = id; stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % width; const y = (p - x) / width;
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); box.pixels += 1;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (mask[q] && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
    boxes.push(box);
  }
  return boxes;
}

function mergeNear(boxes, gap) {
  let merged = boxes.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    const out = [];
    for (const box of merged) {
      const hit = out.find((o) => box.x0 <= o.x1 + gap + 1 && o.x0 <= box.x1 + gap + 1 && box.y0 <= o.y1 + gap + 1 && o.y0 <= box.y1 + gap + 1);
      if (hit) {
        hit.x0 = Math.min(hit.x0, box.x0); hit.y0 = Math.min(hit.y0, box.y0); hit.x1 = Math.max(hit.x1, box.x1); hit.y1 = Math.max(hit.y1, box.y1); hit.pixels += box.pixels;
        changed = true;
      } else out.push(box);
    }
    merged = out;
  }
  return merged;
}

/**
 * Find candidate frames in a hand-packed sheet. Frames are connected regions of
 * non-key pixels (8-neighbour), merged when closer than `gap`. Long sparse
 * regions (grid dividers, borders) are reported separately, not as frames.
 */
export async function sliceSheet({ file, key: keyOverride = null, gap = 1, pad = 1, minPixels = 4 }) {
  const image = await decode(file);
  const key = keyOverride ? (typeof keyOverride === 'string' ? parseKey(keyOverride) : keyOverride) : detectKey(image);
  const mask = foregroundMask(image, key);
  const raw = components(mask, image.width, image.height);
  const dividers = []; const parts = [];
  for (const box of raw) {
    const w = box.x1 - box.x0 + 1; const h = box.y1 - box.y0 + 1;
    const fill = box.pixels / (w * h);
    const long = w >= image.width * 0.5 || h >= image.height * 0.5;
    const thin = Math.min(w, h) <= 2;
    if (long && (thin || fill < 0.25)) dividers.push(box);
    else if (box.pixels >= minPixels) parts.push(box);
  }
  const frames = mergeNear(parts, gap)
    .sort((a, b) => (Math.abs(a.y0 - b.y0) <= 4 ? a.x0 - b.x0 : a.y0 - b.y0))
    .map((box, index) => {
      const x = Math.max(0, box.x0 - pad); const y = Math.max(0, box.y0 - pad);
      const right = Math.min(image.width, box.x1 + 1 + pad); const bottom = Math.min(image.height, box.y1 + 1 + pad);
      return {
        id: `frame-${String(index).padStart(3, '0')}`,
        rect: [x, y, right - x, bottom - y],
        content_bounds: [box.x0 - x, box.y0 - y, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1],
        pixels: box.pixels,
      };
    });
  return { width: image.width, height: image.height, key, frames, dividers: dividers.length };
}

/** Labelled preview: every candidate frame boxed and numbered, enlarged. */
export async function renderSliceReview({ file, slice, out, scale = 2 }) {
  const { createCanvas, loadImage } = await canvasModule();
  const image = await loadImage(file);
  const canvas = createCanvas(image.width * scale, image.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1; ctx.font = `${Math.max(9, 5 * scale)}px sans-serif`;
  for (const frame of slice.frames) {
    const [x, y, w, h] = frame.rect.map((v) => v * scale);
    ctx.strokeStyle = '#ff2050'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const label = frame.id.replace('frame-', '');
    ctx.fillStyle = '#000000'; ctx.fillRect(x, y, ctx.measureText(label).width + 4, 5 * scale + 4);
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, x + 2, y + 5 * scale + 1);
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, canvas.toBuffer('image/png'));
}

/** Copy a keyed sheet with its key colour made transparent (a derived source). */
export async function writeKeyedSheet({ file, key, out }) {
  const { createCanvas } = await canvasModule();
  const image = await decode(file);
  const mask = foregroundMask(image, key);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(image.width, image.height);
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    data.data.set(image.pixels.subarray(p * 4, p * 4 + 4), p * 4);
    data.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  await mkdir(path.dirname(out), { recursive: true });
  const buffer = canvas.toBuffer('image/png');
  await writeFile(out, buffer);
  return { sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

// ── catalog conventions ─────────────────────────────────────────────────────

const TERRAIN_FRAMES = ['fill', 'edge', 'ceiling_edge'];

function rgbaAt(pixels, width, x, y) { const i = (y * width + x) * 4; return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]; }

/**
 * Horizontal seam of a region: how different its last column is from its first,
 * against the region's own 90th-percentile neighbouring-column difference.
 * A repeating strip passes when the wrap looks like any other column step.
 */
export function seamScore({ pixels, width }, [sx, sy, sw, sh], axis = 'x') {
  const at = (u, v) => (axis === 'x' ? rgbaAt(pixels, width, sx + u, sy + v) : rgbaAt(pixels, width, sx + v, sy + u));
  const [length, breadth] = axis === 'x' ? [sw, sh] : [sh, sw];
  const step = (a, b) => { let sum = 0; for (let v = 0; v < breadth; v += 1) { const p = at(a, v); const q = at(b, v); for (let c = 0; c < 4; c += 1) sum += Math.abs(p[c] - q[c]); } return sum / breadth; };
  const inner = [];
  const stride = Math.max(1, Math.floor(length / 128));
  for (let u = 0; u < length - 1; u += stride) inner.push(step(u, u + 1));
  inner.sort((a, b) => a - b);
  const p90 = inner[Math.floor(inner.length * 0.9)] ?? 0;
  const seam = step(length - 1, 0);
  const limit = Math.max(6, 1.5 * p90);
  // Pixel art is full of hard edges: a wrap is also clean when the same
  // transition (last→first column pair) already occurs inside the image.
  const pairGap = (a, b) => { let sum = 0; for (let v = 0; v < breadth; v += 1) { const p1 = at(length - 1, v); const p0 = at(0, v); const q1 = at(a, v); const q0 = at(b, v); for (let c = 0; c < 4; c += 1) sum += Math.abs(p1[c] - q1[c]) + Math.abs(p0[c] - q0[c]); } return sum / breadth; };
  let echo = Infinity;
  if (seam > limit) for (let u = 0; u < length - 1 && echo > 6; u += 1) echo = Math.min(echo, pairGap(u, u + 1), pairGap(u + 1, u));
  return { seam: Math.round(seam * 10) / 10, limit: Math.round(limit * 10) / 10, pass: seam <= limit || echo <= 6, echoes_interior_edge: seam > limit && echo <= 6 };
}

/** Side-scroller rules for one approved catalog asset. Returns error strings. */
export async function validateSideScrollerAsset({ file, asset, prefix }) {
  const errors = [];
  if (asset.distribution !== undefined && !DISTRIBUTIONS.includes(asset.distribution)) errors.push(`${prefix}: distribution must be ${DISTRIBUTIONS.join(' or ')}`);
  const tags = asset.tags ?? [];
  const frames = asset.frames ?? {};
  const repeating = Object.entries(frames).filter(([, frame]) => frame?.repeat !== undefined);
  for (const [name, frame] of repeating) {
    if (!Array.isArray(frame.repeat) || !frame.repeat.length || frame.repeat.some((axis) => !['x', 'y'].includes(axis))) errors.push(`${prefix}: frame ${name} repeat must list x and/or y`);
  }
  if (tags.includes('parallax-layer')) {
    const scroll = asset.scroll;
    if (!scroll || typeof scroll !== 'object') errors.push(`${prefix}: parallax-layer needs a scroll block`);
    else {
      if (!(Number.isFinite(scroll.parallax) && scroll.parallax >= 0)) errors.push(`${prefix}: scroll.parallax must be a number >= 0`);
      const band = scroll.band;
      if (!Array.isArray(band) || band.length !== 2 || band.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || band[1] <= 0 || band[0] + band[1] > 1.0001) errors.push(`${prefix}: scroll.band must be [y, height] fractions with y + height <= 1`);
    }
    if (!frames.default) errors.push(`${prefix}: parallax-layer needs a default frame`);
    else if (!frames.default.repeat?.includes('x')) errors.push(`${prefix}: parallax-layer default frame must repeat on x`);
  }
  if (tags.includes('terrain-strip')) {
    const present = TERRAIN_FRAMES.filter((name) => frames[name]);
    if (!present.length) errors.push(`${prefix}: terrain-strip needs at least one of ${TERRAIN_FRAMES.join(', ')}`);
    if (frames.fill && !['x', 'y'].every((axis) => frames.fill.repeat?.includes(axis))) errors.push(`${prefix}: terrain fill must repeat on x and y`);
    for (const name of ['edge', 'ceiling_edge']) if (frames[name] && !frames[name].repeat?.includes('x')) errors.push(`${prefix}: terrain ${name} must repeat on x`);
  }
  const checked = repeating.filter(([, frame]) => Array.isArray(frame.repeat) && Array.isArray(frame.rect ?? frame.cell));
  if (checked.length) {
    const image = await decode(file);
    for (const [name, frame] of checked) {
      const rect = frame.rect ?? [frame.cell[0] * asset.geometry.cell[0], frame.cell[1] * asset.geometry.cell[1], ...asset.geometry.cell];
      for (const axis of frame.repeat) {
        const score = seamScore(image, rect, axis);
        if (!score.pass) errors.push(`${prefix}: frame ${name} does not tile on ${axis} (seam ${score.seam}, limit ${score.limit})`);
      }
    }
  }
  return errors;
}

// ── skins ───────────────────────────────────────────────────────────────────

async function readYaml(file) { return YAML.parse(await readFile(file, 'utf8'), { uniqueKeys: true }) ?? {}; }

function contractSlot(contract, name) {
  if (contract.slots?.[name]) return contract.slots[name];
  const wildcard = Object.keys(contract.slots ?? {}).find((key) => key.endsWith('.*') && name.startsWith(key.slice(0, -1)) && !name.slice(key.length - 1).includes('.'));
  return wildcard ? contract.slots[wildcard] : null;
}

export function validateContract(contract) {
  const errors = [];
  if (contract.schema !== 'game-skin-contract/v1') errors.push('contract schema must be game-skin-contract/v1');
  if (!ID.test(contract.game ?? '')) errors.push('contract game id is required');
  for (const [name, slot] of Object.entries(contract.slots ?? {})) {
    if (!SLOT_TYPES.has(slot?.type)) errors.push(`contract slot ${name}: type must be ${[...SLOT_TYPES].join(', ')}`);
    if (slot?.scale !== undefined && !(Number.isInteger(slot.scale) && slot.scale >= 1)) errors.push(`contract slot ${name}: scale must be a positive integer`);
    if (slot?.repeat !== undefined && (!Array.isArray(slot.repeat) || slot.repeat.some((a) => !['x', 'y'].includes(a)))) errors.push(`contract slot ${name}: repeat must list x and/or y`);
  }
  if (!Object.keys(contract.slots ?? {}).length) errors.push('contract declares no slots');
  return errors;
}

function frameRefs(asset, ref) {
  if (ref.clip) {
    const clip = asset.clips?.[ref.clip];
    if (!clip) return { error: `clip ${ref.clip} not in asset` };
    const names = clip.frames.map((entry) => (typeof entry === 'string' ? entry : entry.frame));
    const fps = clip.fps ?? Math.round(1000 / (clip.frames[0]?.duration_ms ?? 125));
    return { frames: names, fps, loop: clip.loop ?? 'loop' };
  }
  const name = ref.frame ?? 'default';
  if (!asset.frames?.[name]) return { error: `frame ${name} not in asset` };
  return { frames: [name] };
}

/**
 * Check a skin against its game's contract and the catalog. Fail-closed: an
 * unknown slot, an unapproved asset, a wrong asset role, or a private-only
 * asset in a shippable skin is an error, never a warning.
 */
export async function validateSkin({ root, contractPath, skinPath }) {
  const { loadAssetCatalog } = await import('./lib.mjs');
  const errors = []; const warnings = [];
  const contract = await readYaml(contractPath);
  const skin = await readYaml(skinPath);
  errors.push(...validateContract(contract));
  if (skin.schema !== 'game-skin/v1') errors.push('skin schema must be game-skin/v1');
  if (!ID.test(skin.id ?? '')) errors.push('skin id is required');
  if (skin.game !== contract.game) errors.push(`skin is for ${skin.game}, contract is for ${contract.game}`);
  if (!DISTRIBUTIONS.includes(skin.distribution)) errors.push(`skin distribution must be ${DISTRIBUTIONS.join(' or ')}`);
  if (typeof skin.catalog !== 'string') { errors.push('skin catalog path is required'); return { valid: false, errors, warnings }; }
  const catalogPath = path.isAbsolute(skin.catalog) ? skin.catalog : path.resolve(root, skin.catalog);
  let catalog;
  try { catalog = await loadAssetCatalog(catalogPath); } catch (error) { errors.push(`cannot load catalog: ${error.message}`); return { valid: false, errors, warnings }; }
  const resolved = { layers: [], images: {}, sprites: {} };
  const usedAssets = new Set();
  const useAsset = (slotName, ref) => {
    const asset = catalog.assets?.[ref?.asset];
    if (!asset) { errors.push(`slot ${slotName}: unknown asset ${ref?.asset}`); return null; }
    if (asset.status !== 'approved') errors.push(`slot ${slotName}: asset ${ref.asset} is ${asset.status}, not approved`);
    const distribution = asset.distribution ?? 'private-only';
    if (skin.distribution === 'shippable' && distribution !== 'shippable') errors.push(`slot ${slotName}: asset ${ref.asset} is ${distribution}; a shippable skin may only use shippable assets`);
    usedAssets.add(ref.asset);
    return asset;
  };
  for (const [slotName, value] of Object.entries(skin.slots ?? {})) {
    const slot = contractSlot(contract, slotName);
    if (!slot) { errors.push(`slot ${slotName} is not in the ${contract.game} contract`); continue; }
    if (slot.type === 'parallax-layers') {
      if (!Array.isArray(value) || !value.length) { errors.push(`slot ${slotName}: list one or more layers`); continue; }
      if (slot.max && value.length > slot.max) errors.push(`slot ${slotName}: at most ${slot.max} layers`);
      const ids = new Set();
      for (const layer of value) {
        if (!ID.test(layer?.id ?? '') || ids.has(layer.id)) errors.push(`slot ${slotName}: layer ids must be unique slugs (${layer?.id})`);
        ids.add(layer?.id);
        const asset = useAsset(`${slotName}.${layer?.id}`, layer);
        if (!asset) continue;
        if (!asset.tags?.includes('parallax-layer')) { errors.push(`slot ${slotName}.${layer.id}: asset ${layer.asset} is not a parallax-layer`); continue; }
        const frame = layer.frame ?? 'default';
        if (!asset.frames?.[frame]) { errors.push(`slot ${slotName}.${layer.id}: frame ${frame} not in asset`); continue; }
        const band = layer.band ?? asset.scroll?.band;
        resolved.layers.push({ id: layer.id, asset: layer.asset, frame, parallax: layer.parallax ?? asset.scroll?.parallax ?? 0, band, front: layer.front === true, opacity: layer.opacity });
      }
      continue;
    }
    const asset = useAsset(slotName, value);
    if (!asset) continue;
    const refs = frameRefs(asset, value);
    if (refs.error) { errors.push(`slot ${slotName}: ${refs.error}`); continue; }
    if (slot.type === 'texture' || slot.type === 'strip') {
      if (!asset.tags?.includes('terrain-strip') && !asset.tags?.includes('parallax-layer')) errors.push(`slot ${slotName}: asset ${value.asset} is not a terrain-strip`);
      const frame = asset.frames[refs.frames[0]];
      const missing = (slot.repeat ?? []).filter((axis) => !frame.repeat?.includes(axis));
      if (missing.length) errors.push(`slot ${slotName}: frame ${refs.frames[0]} must repeat on ${missing.join(', ')}`);
      resolved.images[slotName] = { asset: value.asset, frame: refs.frames[0], scale: slot.scale ?? 1 };
    } else if (slot.type === 'sprite') {
      if (!['sprite-sheet', 'effect-sheet', 'image', 'tile-sheet'].includes(asset.kind)) errors.push(`slot ${slotName}: asset ${value.asset} kind ${asset.kind} cannot fill a sprite slot`);
      if (slot.animated && !value.clip) errors.push(`slot ${slotName}: animated slot needs a clip`);
      resolved.sprites[slotName] = { asset: value.asset, ...refs };
    }
  }
  for (const [name, slot] of Object.entries(contract.slots ?? {})) {
    if (slot.required && !name.endsWith('.*') && !skin.slots?.[name]) errors.push(`required slot ${name} is not filled`);
  }
  const unfilled = Object.keys(contract.slots ?? {}).filter((name) => !name.endsWith('.*') && !skin.slots?.[name]);
  if (unfilled.length) warnings.push(`slots left to the game's built-in art: ${unfilled.join(', ')}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings, contract, skin, catalog, catalogPath, resolved, usedAssets: [...usedAssets].sort() };
}

// ── export ──────────────────────────────────────────────────────────────────

async function cropToNative({ createCanvas, image, rect, density, scale = 1 }) {
  const [sx, sy, sw, sh] = rect;
  const w = Math.round(sw / density); const h = Math.round(sh / density);
  const source = createCanvas(sw, sh); const sctx = source.getContext('2d');
  sctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const src = sctx.getImageData(0, 0, sw, sh).data;
  const out = createCanvas(w * scale, h * scale); const octx = out.getContext('2d');
  const data = octx.createImageData(w * scale, h * scale);
  for (let y = 0; y < h * scale; y += 1) for (let x = 0; x < w * scale; x += 1) {
    const fx = Math.floor(x / scale) * density; const fy = Math.floor(y / scale) * density;
    const si = (fy * sw + fx) * 4; const di = (y * w * scale + x) * 4;
    data.data[di] = src[si]; data.data[di + 1] = src[si + 1]; data.data[di + 2] = src[si + 2]; data.data[di + 3] = src[si + 3] === 0 ? 0 : 255;
  }
  octx.putImageData(data, 0, 0);
  return out;
}

/** Shelf-pack rectangles (sizes) left to right, tallest first. Deterministic. */
export function packShelves(items, { maxWidth = 1024, gap = 1 } = {}) {
  const order = items.map((item, index) => ({ ...item, index })).sort((a, b) => b.h - a.h || b.w - a.w || a.index - b.index);
  let x = 0; let y = 0; let shelf = 0; let width = 0;
  const placed = [];
  for (const item of order) {
    if (x > 0 && x + item.w > maxWidth) { y += shelf + gap; x = 0; shelf = 0; }
    placed.push({ ...item, x, y });
    x += item.w + gap; shelf = Math.max(shelf, item.h); width = Math.max(width, x - gap);
  }
  return { placed: placed.sort((a, b) => a.index - b.index), width: Math.max(1, width), height: Math.max(1, y + shelf) };
}

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Compile a skin into the files a game loads: images/<slot>.png for layers and
 * textures, sprites/sheet.png + sheet.json (TexturePacker hash) for sprite
 * frames, and export.json describing every slot plus each asset's provenance.
 * Everything is at native art resolution (catalog pixel_density undone), except
 * where the contract asks for a scale.
 */
export async function exportSkin({ root, contractPath, skinPath, outDir }) {
  const check = await validateSkin({ root, contractPath, skinPath });
  if (!check.valid) return { ok: false, errors: check.errors };
  const { createCanvas, loadImage } = await canvasModule();
  const { catalog, resolved, skin, contract } = check;
  const decoded = new Map();
  const imageFor = async (asset) => {
    const file = path.resolve(root, asset.source);
    if (!decoded.has(file)) decoded.set(file, await loadImage(file));
    return decoded.get(file);
  };
  const files = {};
  const write = async (relative, canvas) => {
    const buffer = canvas.toBuffer('image/png');
    const target = path.join(outDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    files[relative] = sha(buffer);
  };
  const frameRect = (asset, name) => {
    const frame = asset.frames[name];
    return frame.rect ?? [frame.cell[0] * asset.geometry.cell[0], frame.cell[1] * asset.geometry.cell[1], ...asset.geometry.cell];
  };
  const slots = {};
  const layers = [];
  for (const layer of resolved.layers) {
    const asset = catalog.assets[layer.asset];
    const canvas = await cropToNative({ createCanvas, image: await imageFor(asset), rect: frameRect(asset, layer.frame), density: asset.pixel_density ?? 1 });
    const file = `images/layers.${layer.id}.png`;
    await write(file, canvas);
    layers.push({ id: layer.id, file, width: canvas.width, height: canvas.height, parallax: layer.parallax, band: layer.band, front: layer.front, ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}) });
  }
  if (layers.length) slots[Object.keys(contract.slots).find((name) => contract.slots[name].type === 'parallax-layers')] = { layers };
  for (const [slotName, ref] of Object.entries(resolved.images)) {
    const asset = catalog.assets[ref.asset];
    const canvas = await cropToNative({ createCanvas, image: await imageFor(asset), rect: frameRect(asset, ref.frame), density: asset.pixel_density ?? 1, scale: ref.scale });
    const file = `images/${slotName}.png`;
    await write(file, canvas);
    slots[slotName] = { file, width: canvas.width, height: canvas.height, scale: ref.scale };
  }
  const tiles = [];
  for (const [slotName, ref] of Object.entries(resolved.sprites)) {
    const asset = catalog.assets[ref.asset];
    for (const frameName of ref.frames) {
      const canvas = await cropToNative({ createCanvas, image: await imageFor(asset), rect: frameRect(asset, frameName), density: asset.pixel_density ?? 1 });
      tiles.push({ name: `${slotName}.${frameName}`, canvas, w: canvas.width, h: canvas.height });
    }
    slots[slotName] = { frames: [...new Set(ref.frames)].map((name) => `${slotName}.${name}`), ...(ref.fps ? { fps: ref.fps, loop: ref.loop } : {}) };
  }
  const unique = [...new Map(tiles.map((tile) => [tile.name, tile])).values()];
  if (unique.length) {
    const pack = packShelves(unique);
    const sheet = createCanvas(pack.width, pack.height); const ctx = sheet.getContext('2d');
    const frames = {};
    for (const tile of pack.placed) {
      ctx.drawImage(tile.canvas, tile.x, tile.y);
      frames[tile.name] = { frame: { x: tile.x, y: tile.y, w: tile.w, h: tile.h } };
    }
    await write('sprites/sheet.png', sheet);
    const json = Buffer.from(`${JSON.stringify({ frames, meta: { image: 'sheet.png', size: { w: pack.width, h: pack.height }, generator: 'gaming-assets skin-export' } }, null, 1)}\n`);
    await writeFile(path.join(outDir, 'sprites/sheet.json'), json);
    files['sprites/sheet.json'] = sha(json);
  }
  const provenance = Object.fromEntries(check.usedAssets.map((id) => {
    const asset = catalog.assets[id];
    return [id, { source: asset.source, source_sha256: asset.source_sha256 ?? null, license_scope: asset.license_scope, distribution: asset.distribution ?? 'private-only', provenance: asset.provenance ?? null }];
  }));
  const manifest = { schema: 'game-skin-export/v1', skin: skin.id, game: skin.game, distribution: skin.distribution, slots, provenance, files };
  await writeFile(path.join(outDir, 'export.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return { ok: true, outDir, manifest, warnings: check.warnings };
}

// ── preview ─────────────────────────────────────────────────────────────────

/**
 * Game-independent look at an exported skin: layers in their bands, terrain
 * strips along the floor, every sprite slot's first frame in a labelled row.
 */
export async function renderSkinPreview({ exportDir, contractPath, out, width = 1000, height = 600, scale = 3 }) {
  const { createCanvas, loadImage } = await canvasModule();
  const manifest = JSON.parse(await readFile(path.join(exportDir, 'export.json'), 'utf8'));
  const contract = contractPath ? await readYaml(contractPath) : { slots: {} };
  const canvas = createCanvas(width, height); const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#7fb8e8'; ctx.fillRect(0, 0, width, height);
  const load = (file) => loadImage(path.join(exportDir, file));
  const layerSlot = Object.values(manifest.slots).find((slot) => slot.layers);
  for (const layer of (layerSlot?.layers ?? []).filter((l) => !l.front)) {
    const image = await load(layer.file);
    const [by, bh] = layer.band ?? [0, 1];
    const h = bh * height; const w = image.width * (h / image.height);
    for (let x = 0; x < width; x += w) ctx.drawImage(image, x, by * height, w + 0.5, h);
  }
  const floor = Math.round(height * 0.82);
  const tile = async (slotName, top, bottom) => {
    const slot = manifest.slots[slotName]; if (!slot) return;
    const image = await load(slot.file);
    const w = image.width * (contract.slots?.[slotName]?.type === 'texture' ? 1 : scale);
    const h = contract.slots?.[slotName]?.type === 'texture' ? image.height : image.height * scale;
    for (let y = top; y < bottom; y += h) for (let x = 0; x < width; x += w) ctx.drawImage(image, x, y, w, Math.min(h, bottom - y) === h ? h : h);
  };
  const strips = Object.entries(contract.slots ?? {});
  const texture = strips.find(([, s]) => s.type === 'texture')?.[0];
  const edge = strips.find(([, s]) => s.type === 'strip')?.[0];
  if (texture) await tile(texture, floor, height);
  if (edge && manifest.slots[edge]) { const image = await load(manifest.slots[edge].file); for (let x = 0; x < width; x += image.width * scale) ctx.drawImage(image, x, floor - image.height * scale + 4 * scale, image.width * scale, image.height * scale); }
  const sheetSlots = Object.entries(manifest.slots).filter(([, slot]) => slot.frames);
  if (sheetSlots.length) {
    const json = JSON.parse(await readFile(path.join(exportDir, 'sprites/sheet.json'), 'utf8'));
    const sheet = await load('sprites/sheet.png');
    let x = 12; let rowTop = Math.round(height * 0.12); let rowHeight = 0;
    ctx.font = '11px sans-serif';
    for (const [slotName, slot] of sheetSlots) {
      const f = json.frames[slot.frames[0]].frame;
      const w = f.w * scale; const h = f.h * scale;
      if (x + w > width - 12) { x = 12; rowTop += rowHeight + 24; rowHeight = 0; }
      ctx.drawImage(sheet, f.x, f.y, f.w, f.h, x, rowTop, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, rowTop + h + 2, ctx.measureText(slotName).width + 6, 14);
      ctx.fillStyle = '#ffffff'; ctx.fillText(slotName, x + 3, rowTop + h + 13);
      x += Math.max(w, ctx.measureText(slotName).width + 6) + 16; rowHeight = Math.max(rowHeight, h);
    }
  }
  for (const layer of (layerSlot?.layers ?? []).filter((l) => l.front)) {
    const image = await load(layer.file); const [by, bh] = layer.band ?? [0, 1];
    const h = bh * height; const w = image.width * (h / image.height);
    for (let x = 0; x < width; x += w) ctx.drawImage(image, x, by * height, w + 0.5, h);
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, canvas.toBuffer('image/png'));
  return { out };
}
