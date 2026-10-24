// Joins a Skyline Glider act (course YAML) onto its zone (art, sprites, sounds,
// entity classes) so the browser receives one self-contained object per act.
// Asset paths come out media-relative: `<asset_root>/<src>`, or `src` minus its
// leading slash when it is already rooted at the media tree.

export const ENTITY_CLASSES = new Set(['breakable', 'solid', 'scenery']);
const ASSET_FIELDS = ['src', 'fill', 'edge', 'ceiling_edge'];

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function assetPath(root, src) {
  if (typeof src !== 'string' || !src) return null;
  if (src.startsWith('/')) return src.slice(1);
  return root ? `${String(root).replace(/\/+$/, '')}/${src}` : src;
}

function withAssets(root, value) {
  if (!isObject(value)) return value;
  const out = { ...value };
  for (const field of ASSET_FIELDS) if (field in out) out[field] = assetPath(root, out[field]);
  return out;
}

function mergeLayers(base = [], overrides = {}) {
  if (!isObject(overrides)) return base;
  return base.map((layer) => (isObject(overrides[layer.id]) ? { ...layer, ...overrides[layer.id] } : layer));
}

function applyOverrides(zone, overrides) {
  if (!isObject(overrides)) return zone;
  const next = { ...zone };
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'layers') next.layers = mergeLayers(zone.layers, value);
    else if (isObject(value) && isObject(zone[key])) next[key] = { ...zone[key], ...value };
    else next[key] = value;
  }
  return next;
}

export function resolveZone(rawZone, overrides) {
  const zone = applyOverrides(rawZone, overrides);
  const root = zone.asset_root || '';
  const sprites = isObject(zone.sprites)
    ? { sheet: assetPath(root, zone.sprites.sheet), frames: assetPath(root, zone.sprites.frames) }
    : null;
  const sounds = {};
  for (const [cue, src] of Object.entries(isObject(zone.sounds) ? zone.sounds : {})) {
    const resolved = assetPath(root, src);
    if (resolved) sounds[cue] = resolved;
  }
  return {
    id: zone.id,
    name: zone.name || zone.id,
    asset_root: root,
    pixel_art: !!zone.pixel_art,
    layers: (Array.isArray(zone.layers) ? zone.layers : []).map((layer) => withAssets(root, layer)),
    terrain: withAssets(root, isObject(zone.terrain) ? zone.terrain : {}),
    sprites,
    craft: isObject(zone.craft) ? { ...zone.craft } : {},
    collectible: isObject(zone.collectible) ? { ...zone.collectible } : {},
    checkpoint: isObject(zone.checkpoint) ? { ...zone.checkpoint } : {},
    finish: isObject(zone.finish) ? { ...zone.finish } : {},
    weapons: Object.fromEntries(Object.entries(isObject(zone.weapons) ? zone.weapons : {}).filter(([, spec]) => isObject(spec)).map(([kind, spec]) => [kind, { ...spec }])),
    sounds,
  };
}

/** Throws with a readable message when the act cannot be joined to its zone. */
export function resolveAct(act, zones) {
  const zoneId = act.zone || 'alpine';
  const rawZone = zones.get(zoneId);
  if (!rawZone) throw new Error(`act ${act.id} names unknown zone ${zoneId}`);
  const definitions = isObject(rawZone.entities) ? rawZone.entities : {};
  const ids = new Set();
  const entities = (Array.isArray(act.entities) ? act.entities : []).map((placement, index) => {
    const definition = definitions[placement?.entity];
    if (!definition) throw new Error(`act ${act.id} places unknown entity ${placement?.entity}`);
    if (!ENTITY_CLASSES.has(definition.class)) throw new Error(`entity ${placement.entity} has invalid class`);
    const id = placement.id || `${placement.entity}-${index + 1}`;
    if (ids.has(id)) throw new Error(`act ${act.id} repeats entity id ${id}`);
    ids.add(id);
    return {
      id,
      entity: placement.entity,
      class: definition.class,
      at_s: Number(placement.at_s),
      altitude: Number(placement.altitude),
      width_s: Number(placement.width_s ?? definition.width_s ?? 0.5),
      height: Number(placement.height ?? definition.height ?? 0.1),
      ...(definition.frame ? { frame: definition.frame } : {}),
      ...(definition.frames ? { frames: definition.frames, fps: definition.fps } : {}),
      ...(definition.draw ? { draw: definition.draw } : {}),
      ...(Array.isArray(placement.vulnerable_to ?? definition.vulnerable_to) ? { vulnerable_to: [...(placement.vulnerable_to ?? definition.vulnerable_to)] } : {}),
    };
  });
  const { overrides, ...rest } = act;
  return {
    ...structuredClone(rest),
    act: Number.isInteger(act.act) ? act.act : null,
    zone: resolveZone(rawZone, overrides),
    entities,
  };
}
