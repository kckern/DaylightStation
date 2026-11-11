import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { resolveAct } from './resolveAct.mjs';
import { zoneFromSkinExport } from './skinZone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const alpine = YAML.parse(fs.readFileSync(path.join(here, 'zones/alpine.yml'), 'utf8'));

const manifest = {
  schema: 'game-skin-export/v1', skin: 'test-skin', game: 'skyline-glider', distribution: 'private-only',
  slots: {
    layers: { layers: [
      { id: 'sky', file: 'images/layers.sky.png', width: 512, height: 216, parallax: 0.04, band: [0, 1], front: false },
      { id: 'far', file: 'images/layers.far.png', width: 512, height: 140, parallax: 0.14, band: [0.3, 0.55], front: false },
      { id: 'dust', file: 'images/layers.dust.png', width: 256, height: 20, parallax: 1.4, band: [0.9, 0.1], front: true },
    ] },
    'terrain.fill': { file: 'images/terrain.fill.png', width: 48, height: 48, scale: 3 },
    'terrain.edge': { file: 'images/terrain.edge.png', width: 16, height: 8, scale: 1 },
    'terrain.lava_fill': { file: 'images/terrain.lava_fill.png', width: 32, height: 32, scale: 2 },
    craft: { frames: ['craft.fly.0', 'craft.fly.1'], fps: 6, loop: 'loop' },
    collectible: { frames: ['collectible.spin.0', 'collectible.spin.1', 'collectible.spin.2'], fps: 10, loop: 'loop' },
    'weapons.bomb': { frames: ['weapons.bomb.default'] },
    'entities.pine': { frames: ['entities.pine.tree'], size: [12, 28] },
  },
  provenance: {}, files: {},
};

describe('zoneFromSkinExport', () => {
  const zone = zoneFromSkinExport(manifest, { baseZone: alpine, id: 'test-zone', name: 'Test', assetRoot: 'fitness/skyline-glider/test-zone' });

  it('takes art from the skin', () => {
    // Heights are pixels x 2 units (one grid); each band keeps its bottom edge, snapped to the grid.
    expect(zone.layers).toEqual([
      { id: 'sky', kind: 'image', src: 'images/layers.sky.png', parallax: 0.04, y: 0.28, height: 0.72, fallback: 'alpine-sky' },
      { id: 'far', kind: 'image', src: 'images/layers.far.png', parallax: 0.14, y: 0.3833, height: 0.4667, fallback: 'alpine-far' },
      { id: 'dust', kind: 'image', src: 'images/layers.dust.png', parallax: 1.4, y: 0.9333, height: 0.0667, front: true },
    ]);
    expect(zone.terrain).toMatchObject({ fill: 'images/terrain.fill.png', edge: 'images/terrain.edge.png', lava_fill: 'images/terrain.lava_fill.png', edge_lip: alpine.terrain.edge_lip, edge_height: 0.0267 });
    expect(zone.pixel_scale).toBe(2);
    expect(zone.sprites).toEqual({ sheet: 'sprites/sheet.png', frames: 'sprites/sheet.json' });
    expect(zone.craft).toEqual({ frames: ['craft.fly.0', 'craft.fly.1'], fps: 6 });
    expect(zone.weapons.bomb).toEqual({ frame: 'weapons.bomb.default' });
    expect(zone.pixel_art).toBe(true);
    expect(zone.skin).toEqual({ id: 'test-skin', distribution: 'private-only' });
  });

  it('keeps gameplay from the base zone', () => {
    const { frame, ...pinePlay } = zone.entities.pine;
    expect(frame).toBe('entities.pine.tree');
    expect(pinePlay).toEqual(alpine.entities.pine);
    expect(zone.entities.boulder).toEqual(alpine.entities.boulder);
    expect(zone.sounds).toEqual(alpine.sounds);
  });

  it('resolves through resolveAct like any zone', () => {
    const act = { id: 'a1', zone: 'test-zone', entities: [{ id: 'p1', entity: 'pine', at_s: 10, altitude: 0.7 }] };
    const resolved = resolveAct(act, new Map([['test-zone', zone]]));
    expect(resolved.zone.layers[1].src).toBe('fitness/skyline-glider/test-zone/images/layers.far.png');
    expect(resolved.zone.sprites.sheet).toBe('fitness/skyline-glider/test-zone/sprites/sheet.png');
    expect(resolved.zone.pixel_scale).toBe(2);
    expect(resolved.zone.terrain.lava_fill).toBe('fitness/skyline-glider/test-zone/images/terrain.lava_fill.png');
    expect(resolved.entities[0]).toMatchObject({ id: 'p1', class: 'breakable', frame: 'entities.pine.tree', draw: 'pine' });
  });

  it('refuses an entity sprite larger than the entity collision box', () => {
    // pine: 0.5 s x 71.4 units = 35 units -> 17 px wide; 0.14 x 600 = 84 units -> 42 px tall
    const big = { ...manifest, slots: { ...manifest.slots, 'entities.pine': { frames: ['entities.pine.tree'], size: [20, 28] } } };
    expect(() => zoneFromSkinExport(big, { baseZone: alpine, id: 'x' })).toThrow(/pine is 20x28 px, its box holds 17x42/);
  });

  it('carries vertical slices onto walls and per-piece slices onto gates, through resolveAct', () => {
    const sliced = { ...manifest, slots: { ...manifest.slots,
      'entities.bombwall': { frames: ['entities.bombwall.body'], size: [32, 0], slices: { body: 'entities.bombwall.body' } },
      'entities.gate': { frames: ['entities.gate.cap', 'entities.gate.body'], size: [16, 0], pieces: { top: { body: 'entities.gate.body' }, bottom: { top: 'entities.gate.cap', body: 'entities.gate.body' } } },
    } };
    const zoned = zoneFromSkinExport(sliced, { baseZone: alpine, id: 'z' });
    expect(zoned.entities.bombwall).toMatchObject({ class: 'solid', slices: { body: 'entities.bombwall.body' } });
    expect(zoned.entities.bombwall.frame).toBeUndefined();
    const act = { id: 'a', zone: 'z', entities: [
      { id: 'w1', entity: 'bombwall', at_s: 10, altitude: 1 },
      { id: 'g1', entity: 'gate', at_s: 20, gap_altitude: 0.6, gap: 0.28, closes_at_s: 19 },
    ] };
    const resolved = resolveAct(act, new Map([['z', zoned]]));
    const byId = Object.fromEntries(resolved.entities.map((e) => [e.id, e]));
    expect(byId.w1.slices).toEqual({ body: 'entities.bombwall.body' });
    expect(byId['g1-top'].slices).toEqual({ body: 'entities.gate.body' });
    expect(byId['g1-bottom'].slices).toEqual({ top: 'entities.gate.cap', body: 'entities.gate.body' });
    expect(byId['g1-shutter'].slices).toBeUndefined();
    expect(byId['g1-top'].piece_slices).toBeUndefined();
  });

  it('rejects exports for another game and entities the zone lacks', () => {
    expect(() => zoneFromSkinExport({ ...manifest, game: 'flyer' }, { baseZone: alpine, id: 'x' })).toThrow(/not skyline-glider/);
    const stray = { ...manifest, slots: { ...manifest.slots, 'entities.dragon': { frames: ['entities.dragon.a'] } } };
    expect(() => zoneFromSkinExport(stray, { baseZone: alpine, id: 'x' })).toThrow(/dragon/);
  });
});
