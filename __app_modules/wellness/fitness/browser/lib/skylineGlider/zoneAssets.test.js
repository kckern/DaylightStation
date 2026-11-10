import { describe, expect, it } from 'vitest';
import { loadZoneAssets, parseSpriteFrames, zoneImagePaths } from "./zoneAssets.js";

const zone = {
  layers: [{ id: 'sky', kind: 'svg', draw: 'alpine-sky' }, { id: 'far', kind: 'image', src: 'z/far.png' }],
  terrain: { fill: 'z/rock.png', edge: 'z/grass.png' },
  sprites: { sheet: 'z/sprites.png', frames: 'z/sprites.json' },
};

describe('zone assets', () => {
  it('lists every referenced image once', () => {
    expect(zoneImagePaths(zone)).toEqual(['z/far.png', 'z/rock.png', 'z/grass.png', 'z/sprites.png']);
  });

  it('reads hash and array sprite exports and drops file extensions', () => {
    expect(parseSpriteFrames({ frames: { 'glider-1.png': { frame: { x: 0, y: 0, w: 32, h: 16 } }, bad: {} } }))
      .toEqual({ 'glider-1': { x: 0, y: 0, w: 32, h: 16 } });
    expect(parseSpriteFrames({ frames: [{ filename: 'tree.png', frame: { x: 32, y: 0, w: 16, h: 32 } }] }))
      .toEqual({ tree: { x: 32, y: 0, w: 16, h: 32 } });
  });

  it('reports each failed file and keeps the ones that loaded', async () => {
    const assets = await loadZoneAssets(zone, {
      mediaUrl: (path) => `/media/${path}`,
      loadImage: async (url) => {
        if (url.endsWith('rock.png')) throw new Error('load-failed');
        return { width: 64, height: 32 };
      },
      fetchJson: async () => ({ frames: { glider: { frame: { x: 0, y: 0, w: 8, h: 8 } } } }),
    });
    expect([...assets.images.keys()].sort()).toEqual(['z/far.png', 'z/grass.png', 'z/sprites.png']);
    expect(assets.images.get('z/far.png')).toEqual({ url: '/media/z/far.png', width: 64, height: 32 });
    expect(assets.missing).toEqual([{ src: 'z/rock.png', reason: 'load-failed' }]);
    expect(assets.frames.glider).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });

  it('drops the sheet when its frame map does not load', async () => {
    const assets = await loadZoneAssets(zone, {
      loadImage: async () => ({ width: 8, height: 8 }),
      fetchJson: async () => { throw new Error('http-404'); },
    });
    expect(assets.sheet).toBeNull();
    expect(assets.missing).toEqual([{ src: 'z/sprites.json', reason: 'http-404' }]);
  });
});
