import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { IconManifestStore, ICON_SLUG_PATTERN } from './IconManifestStore.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A media tree plus a manifest describing it, both real files on disk. */
function fixture(manifest, { files = ['img/nutrition/icons/vegetables/carrot.png'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-manifest-'));
  const mediaRoot = path.join(root, 'media');
  for (const rel of files) {
    const full = path.join(mediaRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `bytes of ${rel}`);
  }
  const dataService = {
    household: {
      read: (rel) => (rel === 'apps/health/icon-manifest' ? manifest : null),
    },
  };
  return { root, mediaRoot, store: new IconManifestStore({ dataService, mediaRoot, logger: silent }) };
}

const BASE_MANIFEST = {
  icons: { carrot: { path: 'img/nutrition/icons/vegetables/carrot.png' } },
  aliases: { apple_sauce: { path: 'img/icons/food/apple_sauce.png' } },
};

describe('IconManifestStore', () => {
  it('resolves a primary slug to the absolute path the manifest names', () => {
    const { mediaRoot, store } = fixture(BASE_MANIFEST);
    const hit = store.resolve('carrot');
    expect(hit).not.toBeNull();
    expect(hit.absolutePath).toBe(path.join(mediaRoot, 'img/nutrition/icons/vegetables/carrot.png'));
    expect(hit.contentType).toBe('image/png');
  });

  it('resolves a legacy alias slug, because a stored FoodItem.icon must never stop working', () => {
    const { mediaRoot, store } = fixture(BASE_MANIFEST, {
      files: ['img/nutrition/icons/vegetables/carrot.png', 'img/icons/food/apple_sauce.png'],
    });
    const hit = store.resolve('apple_sauce');
    expect(hit.absolutePath).toBe(path.join(mediaRoot, 'img/icons/food/apple_sauce.png'));
  });

  it('list() offers PRIMARY slugs only: an alias resolves but is never offered', () => {
    const { store } = fixture(BASE_MANIFEST);
    expect(store.list()).toEqual(['carrot']);
    expect(store.list()).not.toContain('apple_sauce');
  });

  it('has(slug) is true for primaries and aliases alike', () => {
    const { store } = fixture(BASE_MANIFEST);
    expect(store.has('carrot')).toBe(true);
    expect(store.has('apple_sauce')).toBe(true);
    expect(store.has('nope')).toBe(false);
  });

  it('search() matches substrings over the primary vocabulary and respects the limit', () => {
    const { store } = fixture({
      icons: {
        carrot: { path: 'img/a.png' }, 'carrot-cake': { path: 'img/b.png' }, apple: { path: 'img/c.png' },
      },
      aliases: {},
    });
    expect(store.search('carrot')).toEqual(['carrot', 'carrot-cake']);
    expect(store.search('carrot', 1)).toEqual(['carrot']);
    expect(store.search('')).toEqual(['apple', 'carrot', 'carrot-cake']);
  });

  it('returns null for a slug that is not in the manifest at all', () => {
    const { store } = fixture(BASE_MANIFEST);
    expect(store.resolve('not-a-real-icon')).toBeNull();
  });

  it('returns null when the manifest names a file that is not on disk (a Dropbox-emptied folder)', () => {
    const { store } = fixture({ icons: { ghost: { path: 'img/nutrition/icons/gone/ghost.png' } }, aliases: {} });
    expect(store.resolve('ghost')).toBeNull();
  });

  it('survives a missing manifest: empty vocabulary, no throw', () => {
    const store = new IconManifestStore({
      dataService: { household: { read: () => null } }, mediaRoot: '/nonexistent', logger: silent,
    });
    expect(store.list()).toEqual([]);
    expect(store.resolve('carrot')).toBeNull();
  });

  describe('the slug never participates in a path join until it passes the allowlist', () => {
    const hostile = [
      '../../../etc/passwd',
      '..',
      '../secret',
      '/etc/passwd',
      'carrot/../../../etc/passwd',
      'carrot .png',
      'carrot.png',
      '-leading-dash',
      '',
      'CARROT/../x',
    ];
    for (const slug of hostile) {
      it(`refuses ${JSON.stringify(slug)}`, () => {
        const { store } = fixture(BASE_MANIFEST);
        expect(ICON_SLUG_PATTERN.test(slug)).toBe(false);
        expect(store.resolve(slug)).toBeNull();
      });
    }

    it('refuses non-string slugs', () => {
      const { store } = fixture(BASE_MANIFEST);
      for (const slug of [null, undefined, 42, {}, ['carrot']]) expect(store.resolve(slug)).toBeNull();
    });
  });

  describe('a hostile MANIFEST cannot escape the media root either', () => {
    it('refuses a manifest entry whose path climbs out with ..', () => {
      const { root, store } = fixture({ icons: { evil: { path: '../../../etc/passwd' } }, aliases: {} });
      fs.mkdirSync(path.join(root, 'outside'), { recursive: true });
      fs.writeFileSync(path.join(root, 'outside', 'secret.png'), 'SECRET');
      expect(store.resolve('evil')).toBeNull();
    });

    it('refuses a manifest entry that names an absolute path', () => {
      const { store } = fixture({ icons: { evil: { path: '/etc/passwd' } }, aliases: {} });
      expect(store.resolve('evil')).toBeNull();
    });

    it('refuses a manifest entry with a traversal segment that still lands inside the root', () => {
      // media/img/x/../nutrition/... resolves INSIDE mediaRoot, so a containment
      // check alone would pass it. Traversal segments are refused outright so the
      // manifest stays a flat, auditable list of real paths.
      const { store } = fixture({
        icons: { sneaky: { path: 'img/x/../nutrition/icons/vegetables/carrot.png' } }, aliases: {},
      });
      expect(store.resolve('sneaky')).toBeNull();
    });

    it('refuses a manifest entry with an extension that is not an image we serve', () => {
      const { mediaRoot, store } = fixture({ icons: { evil: { path: 'img/evil.svg' } }, aliases: {} });
      fs.mkdirSync(path.join(mediaRoot, 'img'), { recursive: true });
      fs.writeFileSync(path.join(mediaRoot, 'img/evil.svg'), '<svg />');
      expect(store.resolve('evil')).toBeNull();
    });

    it('refuses a manifest entry with no path at all', () => {
      const { store } = fixture({ icons: { broken: {} }, aliases: {} });
      expect(store.resolve('broken')).toBeNull();
    });
  });

  it('serves image/jpeg for .jpg and .jpeg entries', () => {
    const { store } = fixture(
      { icons: { a: { path: 'img/a.jpg' }, b: { path: 'img/b.jpeg' } }, aliases: {} },
      { files: ['img/a.jpg', 'img/b.jpeg'] },
    );
    expect(store.resolve('a').contentType).toBe('image/jpeg');
    expect(store.resolve('b').contentType).toBe('image/jpeg');
  });

  it('reads the manifest ONCE: repeated resolves do not re-read the file', () => {
    let reads = 0;
    const dataService = { household: { read: () => { reads += 1; return BASE_MANIFEST; } } };
    const store = new IconManifestStore({ dataService, mediaRoot: '/nowhere', logger: silent });
    store.list(); store.list(); store.resolve('carrot');
    expect(reads).toBe(1);
  });
});

describe('IconManifestStore over the real installed manifest shape', () => {
  it('parses a manifest written as YAML by the curation script', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-manifest-yaml-'));
    const mediaRoot = path.join(root, 'media');
    fs.mkdirSync(path.join(mediaRoot, 'img/nutrition/icons/tea'), { recursive: true });
    fs.writeFileSync(path.join(mediaRoot, 'img/nutrition/icons/tea/matcha.png'), 'x');
    const doc = yaml.load(yaml.dump({
      icons: { matcha: { path: 'img/nutrition/icons/tea/matcha.png' } },
      aliases: {},
    }));
    const store = new IconManifestStore({
      dataService: { household: { read: () => doc } }, mediaRoot, logger: silent,
    });
    expect(store.resolve('matcha').absolutePath).toBe(path.join(mediaRoot, 'img/nutrition/icons/tea/matcha.png'));
  });
});

// The hi-res source art averages ~3 MB a file. A day's log renders one icon per
// row at 24 CSS px and the picker shows up to 60 at 40 CSS px, so serving the
// sources verbatim costs tens of megabytes per day view and well over a hundred
// for one open picker. Every request serves a cached downscale instead.
describe('IconManifestStore.resolveRendered', () => {
  // A real 512px PNG, so jimp has something genuine to decode and shrink.
  async function bigPng() {
    const { Jimp } = await import('jimp');
    const image = new Jimp({ width: 512, height: 512, color: 0xff0000ff });
    return image.getBuffer('image/png');
  }

  async function renderFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-render-'));
    const mediaRoot = path.join(root, 'media');
    const cacheDir = path.join(root, 'data/household/apps/health/icon-cache');
    const rel = 'img/nutrition/icons/vegetables/carrot.png';
    fs.mkdirSync(path.dirname(path.join(mediaRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(mediaRoot, rel), await bigPng());
    const doc = { icons: { carrot: { path: rel } }, aliases: {} };
    const dataService = {
      household: { read: () => doc, resolveDir: (p) => path.join(root, 'data/household', p) },
    };
    return {
      root, mediaRoot, cacheDir, rel, doc,
      store: new IconManifestStore({ dataService, mediaRoot, logger: silent }),
      sourceBytes: fs.statSync(path.join(mediaRoot, rel)).size,
    };
  }

  it('serves a downscaled derivative, not the source file', async () => {
    const f = await renderFixture();
    const hit = await f.store.resolveRendered('carrot');
    expect(hit.absolutePath).not.toBe(path.join(f.mediaRoot, f.rel));
    expect(hit.absolutePath.startsWith(f.cacheDir)).toBe(true);
    expect(hit.contentType).toBe('image/png');
    expect(fs.statSync(hit.absolutePath).size).toBeLessThan(f.sourceBytes);
  });

  it('the derivative is a real decodable image at the render width', async () => {
    const f = await renderFixture();
    const hit = await f.store.resolveRendered('carrot');
    const { Jimp } = await import('jimp');
    const out = await Jimp.read(hit.absolutePath);
    expect(out.bitmap.width).toBe(96);
  });

  it('generates once: a second call reuses the cached file untouched', async () => {
    const f = await renderFixture();
    const first = await f.store.resolveRendered('carrot');
    const mtime = fs.statSync(first.absolutePath).mtimeMs;
    const second = await f.store.resolveRendered('carrot');
    expect(second.absolutePath).toBe(first.absolutePath);
    expect(fs.statSync(second.absolutePath).mtimeMs).toBe(mtime);
  });

  // Otherwise a manifest correction would keep serving the old picture forever,
  // behind an immutable year-long cache header.
  it('repointing the slug at a different file yields a different cache entry', async () => {
    const f = await renderFixture();
    const first = await f.store.resolveRendered('carrot');
    const other = 'img/nutrition/icons/vegetables/other.png';
    const { Jimp } = await import('jimp');
    fs.writeFileSync(
      path.join(f.mediaRoot, other),
      await new Jimp({ width: 300, height: 300, color: 0x00ff00ff }).getBuffer('image/png'),
    );
    f.doc.icons.carrot.path = other;
    f.store.reload();
    const second = await f.store.resolveRendered('carrot');
    expect(second.absolutePath).not.toBe(first.absolutePath);
  });

  // This one has to reach the RENDER path to mean anything: a fixture with no
  // cache directory returns the original before jimp is ever called, which
  // would make this a duplicate of the test below rather than a test of the
  // decode-failure fallback. So it is given a real cache directory and a
  // source that is not an image.
  it('an undecodable source falls back to serving the original, never a 404', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-render-bad-'));
    const mediaRoot = path.join(root, 'media');
    const rel = 'img/nutrition/icons/vegetables/carrot.png';
    fs.mkdirSync(path.dirname(path.join(mediaRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(mediaRoot, rel), 'this is emphatically not a PNG');
    const store = new IconManifestStore({
      dataService: {
        household: {
          read: () => ({ icons: { carrot: { path: rel } }, aliases: {} }),
          resolveDir: (p) => path.join(root, 'data/household', p),
        },
      },
      mediaRoot,
      logger: silent,
    });
    const hit = await store.resolveRendered('carrot');
    expect(hit).not.toBeNull();
    expect(hit.absolutePath).toBe(path.join(mediaRoot, rel));
  });

  it('no cache directory (a dataService without resolveDir) falls back to the original', async () => {
    const { store, mediaRoot } = fixture(BASE_MANIFEST);
    const hit = await store.resolveRendered('carrot');
    expect(hit.absolutePath).toBe(path.join(mediaRoot, 'img/nutrition/icons/vegetables/carrot.png'));
  });

  it('an unknown slug is still null — rendering never invents a hit', async () => {
    const f = await renderFixture();
    expect(await f.store.resolveRendered('nosuchicon')).toBeNull();
    expect(await f.store.resolveRendered('../../../etc/passwd')).toBeNull();
  });
});
