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
    craft: { frames: ['craft.fly.0', 'craft.fly.1'], fps: 6, loop: 'loop' },
    collectible: { frames: ['collectible.spin.0', 'collectible.spin.1', 'collectible.spin.2'], fps: 10, loop: 'loop' },
    'weapons.bomb': { frames: ['weapons.bomb.default'] },
    'entities.pine': { frames: ['entities.pine.tree'] },
  },
  provenance: {}, files: {},
};

describe('zoneFromSkinExport', () => {
  const zone = zoneFromSkinExport(manifest, { baseZone: alpine, id: 'test-zone', name: 'Test', assetRoot: 'fitness/skyline-glider/test-zone' });

  it('takes art from the skin', () => {
    // Heights are pixels x 3 units (one grid); each band keeps its bottom edge.
    expect(zone.layers).toEqual([
      { id: 'sky', kind: 'image', src: 'images/layers.sky.png', parallax: 0.04, y: 0, height: 1, fallback: 'alpine-sky' },
      { id: 'far', kind: 'image', src: 'images/layers.far.png', parallax: 0.14, y: 0.15, height: 0.7, fallback: 'alpine-far' },
      { id: 'dust', kind: 'image', src: 'images/layers.dust.png', parallax: 1.4, y: 0.9, height: 0.1, front: true },
    ]);
    expect(zone.terrain).toMatchObject({ fill: 'images/terrain.fill.png', edge: 'images/terrain.edge.png', edge_lip: alpine.terrain.edge_lip, edge_height: 0.04 });
    expect(zone.pixel_scale).toBe(3);
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
    expect(resolved.zone.pixel_scale).toBe(3);
    expect(resolved.entities[0]).toMatchObject({ id: 'p1', class: 'breakable', frame: 'entities.pine.tree', draw: 'pine' });
  });

  it('rejects exports for another game and entities the zone lacks', () => {
    expect(() => zoneFromSkinExport({ ...manifest, game: 'flyer' }, { baseZone: alpine, id: 'x' })).toThrow(/not skyline-glider/);
    const stray = { ...manifest, slots: { ...manifest.slots, 'entities.dragon': { frames: ['entities.dragon.a'] } } };
    expect(() => zoneFromSkinExport(stray, { baseZone: alpine, id: 'x' })).toThrow(/dragon/);
  });
});
