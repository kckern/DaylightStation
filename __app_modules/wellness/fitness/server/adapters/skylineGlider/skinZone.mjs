// Turns a gaming-assets skin export (export.json) into a Skyline Glider zone.
//
// Art comes from the skin; everything about play (entity classes, roles,
// sizes, vulnerabilities, sounds, palette) comes from the base zone, so a skin
// can never change how a course plays. Slots the skin leaves empty keep the
// base zone's settings, which fall back to the built-in SVG art.

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function frames(spec) {
  return spec.frames.length === 1 ? { frame: spec.frames[0] } : { frames: [...spec.frames], fps: spec.fps ?? 8 };
}

/** A slot's art as the zone spells it: frame or frames + fps, plus any states. */
function animation(slot) {
  if (!slot?.frames?.length) return null;
  const states = slot.states ? Object.fromEntries(Object.entries(slot.states).map(([name, spec]) => [name, frames(spec)])) : null;
  return { ...frames(slot), ...(states ? { states } : {}) };
}

const snap = (units, step) => Math.round(units / step) * step;

/**
 * `artPixel` (scene units per art pixel, from the contract) puts the whole zone
 * on one pixel grid: layer and terrain-edge heights come from their pixel sizes,
 * and sprites draw at that grain (zone.pixel_scale) instead of stretching.
 */
const UNITS_PER_SECOND = 1000 / 14;   // courseProjection: 1000 units across 14 s

export function zoneFromSkinExport(manifest, { baseZone, id, name, assetRoot, artPixel = 2, sceneHeight = 600 }) {
  if (manifest?.schema !== 'game-skin-export/v1') throw new Error('not a game-skin-export/v1 manifest');
  if (manifest.game !== 'skyline-glider') throw new Error(`export is for ${manifest.game}, not skyline-glider`);
  if (!isObject(baseZone)) throw new Error('baseZone is required');
  const slots = manifest.slots ?? {};
  const zone = structuredClone(baseZone);
  zone.id = id;
  zone.name = name ?? id;
  zone.asset_root = assetRoot;
  zone.pixel_art = true;
  zone.pixel_scale = artPixel;
  zone.skin = { id: manifest.skin, distribution: manifest.distribution };

  const layers = slots.layers?.layers;
  if (layers?.length) {
    const fallbackFor = new Map((baseZone.layers ?? []).filter((layer) => layer.draw).map((layer) => [layer.id, layer.draw]));
    zone.layers = layers.map((layer) => {
      // Height is the strip's own pixels on the grid; the band's bottom edge is kept.
      const height = Math.min(sceneHeight, layer.height * artPixel);
      const bottom = ((layer.band?.[0] ?? 0) + (layer.band?.[1] ?? 1)) * sceneHeight;
      const top = Math.max(0, snap(Math.min(bottom, sceneHeight) - height, artPixel));
      return {
      id: layer.id,
      kind: 'image',
      src: layer.file,
      parallax: layer.parallax,
      y: Math.round((top / sceneHeight) * 10000) / 10000,
      height: Math.round((height / sceneHeight) * 10000) / 10000,
      ...(layer.front ? { front: true } : {}),
      ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}),
      ...(fallbackFor.has(layer.id) ? { fallback: fallbackFor.get(layer.id) } : {}),
      };
    });
  }

  const terrain = { ...(baseZone.terrain ?? {}) };
  for (const field of ['fill', 'edge', 'ceiling_edge', 'lava_fill', 'lava_edge']) if (slots[`terrain.${field}`]?.file) terrain[field] = slots[`terrain.${field}`].file;
  const strip = slots['terrain.edge'] ?? slots['terrain.ceiling_edge'];
  if (strip?.height) terrain.edge_height = Math.round(((strip.height * artPixel) / sceneHeight) * 10000) / 10000;
  zone.terrain = terrain;

  const usesSheet = Object.values(slots).some((slot) => slot?.frames?.length);
  zone.sprites = usesSheet ? { sheet: 'sprites/sheet.png', frames: 'sprites/sheet.json' } : null;
  for (const key of ['craft', 'collectible', 'checkpoint', 'finish']) {
    const art = animation(slots[key]);
    if (art) zone[key] = { ...(isObject(baseZone[key]) ? baseZone[key] : {}), ...art, draw: undefined };
  }
  zone.weapons = { ...(isObject(baseZone.weapons) ? baseZone.weapons : {}) };
  for (const kind of ['laser', 'bomb', 'missile', 'blast']) {
    const art = animation(slots[`weapons.${kind}`]);
    if (art) zone.weapons[kind] = art;
  }
  const entities = structuredClone(isObject(baseZone.entities) ? baseZone.entities : {});
  const unknown = []; const oversized = [];
  for (const [slotName, slot] of Object.entries(slots)) {
    if (!slotName.startsWith('entities.')) continue;
    const entity = slotName.slice('entities.'.length);
    if (!entities[entity]) { unknown.push(entity); continue; }
    // What you see is what collides: the sprite must fit the entity's box on the grid.
    if (Array.isArray(slot.size)) {
      const def = entities[entity];
      const fits = [Math.floor((Number(def.width_s ?? 0.5) * UNITS_PER_SECOND) / artPixel), Math.floor((Number(def.height ?? 0.1) * sceneHeight) / artPixel)];
      if (slot.size[0] > fits[0] || slot.size[1] > fits[1]) oversized.push(`${entity} is ${slot.size[0]}x${slot.size[1]} px, its box holds ${fits[0]}x${fits[1]}`);
    }
    if (slot.slices || slot.pieces) {
      delete entities[entity].frame; delete entities[entity].frames; delete entities[entity].fps;
      if (slot.slices) entities[entity].slices = { ...slot.slices };
      if (slot.pieces) entities[entity].piece_slices = structuredClone(slot.pieces);
      continue;
    }
    const art = animation(slot);
    if (art) { delete entities[entity].frame; delete entities[entity].frames; delete entities[entity].fps; delete entities[entity].states; Object.assign(entities[entity], art); }
  }
  if (unknown.length) throw new Error(`skin dresses entities the base zone does not define: ${unknown.join(', ')}`);
  if (oversized.length) throw new Error(`entity sprites larger than their collision boxes: ${oversized.join('; ')}`);
  zone.entities = entities;
  return JSON.parse(JSON.stringify(zone));
}
