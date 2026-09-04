import { describe, it, expect, vi } from 'vitest';
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

    // `path.resolve` is PURELY LEXICAL: it collapses `..` and `.` but knows
    // nothing about symlinks, so a link planted inside the media root pointing
    // outside it passes a resolve-based containment check and serves content
    // from outside the root. Reaching this needs write access to the media
    // mount, so it is not user-reachable — but "cannot escape" has to mean
    // cannot escape, and containment is now checked on the REAL path.
    describe('symlinks out of the media root', () => {
      /** A media tree with `outside/` next to it, holding the secret. */
      function linkFixture(manifest) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-symlink-'));
        const mediaRoot = path.join(root, 'media');
        const outside = path.join(root, 'outside');
        fs.mkdirSync(path.join(mediaRoot, 'img/nutrition/icons/vegetables'), { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'secret.png'), 'SECRET BYTES FROM OUTSIDE THE ROOT');
        const dataService = { household: { read: () => manifest } };
        return {
          root, mediaRoot, outside,
          store: new IconManifestStore({ dataService, mediaRoot, logger: silent }),
        };
      }

      it('refuses a FILE symlink that points outside the media root', () => {
        const f = linkFixture({
          icons: { leaky: { path: 'img/nutrition/icons/vegetables/leaky.png' } }, aliases: {},
        });
        fs.symlinkSync(
          path.join(f.outside, 'secret.png'),
          path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/leaky.png'),
        );
        // The lexical path is squarely inside the root; only the real path is not.
        expect(fs.existsSync(path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/leaky.png'))).toBe(true);
        expect(f.store.resolve('leaky')).toBeNull();
      });

      it('refuses a file reached through a DIRECTORY symlink that points outside the root', () => {
        const f = linkFixture({
          icons: { leaky: { path: 'img/nutrition/icons/escape/secret.png' } }, aliases: {},
        });
        fs.symlinkSync(f.outside, path.join(f.mediaRoot, 'img/nutrition/icons/escape'));
        expect(fs.existsSync(path.join(f.mediaRoot, 'img/nutrition/icons/escape/secret.png'))).toBe(true);
        expect(f.store.resolve('leaky')).toBeNull();
      });

      it('still serves a symlink that stays INSIDE the root — the check is containment, not a ban on links', () => {
        const f = linkFixture({
          icons: { linked: { path: 'img/nutrition/icons/vegetables/linked.png' } }, aliases: {},
        });
        const real = path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/real.png');
        fs.writeFileSync(real, 'legitimate bytes');
        fs.symlinkSync(real, path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/linked.png'));
        const hit = f.store.resolve('linked');
        expect(hit).not.toBeNull();
        expect(hit.absolutePath).toBe(real); // reported as the real path
      });

      // A media root that is ITSELF reached through a link is an ordinary mount
      // layout (and the exact shape used to falsify the asset guard). Comparing
      // a realpath'd candidate against a lexical root would reject every icon
      // under such a root — the fix must not trade an escape for an outage.
      it('serves normally when the media ROOT is itself reached through a symlink', () => {
        const real = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-realroot-'));
        const rel = 'img/nutrition/icons/vegetables/carrot.png';
        fs.mkdirSync(path.join(real, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(real, rel), 'legitimate bytes');
        const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-linkroot-'));
        const linkedRoot = path.join(linkParent, 'media');
        fs.symlinkSync(real, linkedRoot);

        const store = new IconManifestStore({
          dataService: { household: { read: () => ({ icons: { carrot: { path: rel } }, aliases: {} }) } },
          mediaRoot: linkedRoot,
          logger: silent,
        });
        const hit = store.resolve('carrot');
        expect(hit).not.toBeNull();
        expect(fs.readFileSync(hit.absolutePath, 'utf8')).toBe('legitimate bytes');
      });

      it('a dangling symlink is a miss, not a throw', () => {
        const f = linkFixture({
          icons: { dangling: { path: 'img/nutrition/icons/vegetables/dangling.png' } }, aliases: {},
        });
        fs.symlinkSync(
          path.join(f.outside, 'never-existed.png'),
          path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/dangling.png'),
        );
        expect(f.store.resolve('dangling')).toBeNull();
      });
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

// A render is ~250-500 ms of SYNCHRONOUS jimp work on the event loop, and the
// edit sheet's picker asks for 60 icons at once. Before the gate below, 60 cold
// renders took 16.3 s wall on a real backend and dragged an unrelated endpoint
// from 2.1 ms to 3.35 s at worst — the whole process, not just health.
describe('IconManifestStore render concurrency', () => {
  async function manyIconFixture(count) {
    const { Jimp } = await import('jimp');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-herd-'));
    const mediaRoot = path.join(root, 'media');
    const dir = 'img/nutrition/icons/vegetables';
    fs.mkdirSync(path.join(mediaRoot, dir), { recursive: true });
    const icons = {};
    for (let i = 0; i < count; i += 1) {
      const rel = `${dir}/icon-${i}.png`;
      // Distinct colours so no two sources are byte-identical.
      // eslint-disable-next-line no-await-in-loop
      fs.writeFileSync(path.join(mediaRoot, rel), await new Jimp({
        width: 200, height: 200, color: (0x010203ff + i * 0x00010100) >>> 0,
      }).getBuffer('image/png'));
      icons[`icon-${i}`] = { path: rel };
    }
    const doc = { icons, aliases: {} };
    const renders = [];
    const logger = {
      ...silent,
      debug: (event, data) => { if (event === 'health.icons.render.cached') renders.push(data); },
    };
    return {
      root,
      mediaRoot,
      doc,
      renders: () => renders,
      store: new IconManifestStore({
        dataService: {
          household: { read: () => doc, resolveDir: (p) => path.join(root, 'data/household', p) },
        },
        mediaRoot,
        logger,
      }),
    };
  }

  it('never runs more than one render at a time, however many arrive at once', async () => {
    const f = await manyIconFixture(8);
    const { Jimp } = await import('jimp');
    let active = 0;
    let peak = 0;
    const realRead = Jimp.read.bind(Jimp);
    const spy = vi.spyOn(Jimp, 'read').mockImplementation(async (...args) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise((r) => { setTimeout(r, 5); });
        return await realRead(...args);
      } finally { active -= 1; }
    });
    try {
      await Promise.all([...Array(8).keys()].map((i) => f.store.resolveRendered(`icon-${i}`)));
    } finally { spy.mockRestore(); }
    expect(peak).toBe(1);
  });

  // Counted through the store's OWN render log rather than a jimp spy: the
  // module-level spy is unreliable once another test in the file has restored
  // one, and `render.cached` is emitted exactly once per real decode.
  it('collapses simultaneous requests for the SAME icon into one decode', async () => {
    const f = await manyIconFixture(1);
    const hits = await Promise.all([...Array(12).keys()].map(() => f.store.resolveRendered('icon-0')));
    expect(f.renders()).toHaveLength(1);
    expect(new Set(hits.map((h) => h.absolutePath)).size).toBe(1);
    expect(fs.existsSync(hits[0].absolutePath)).toBe(true);
  });

  it('every queued request still gets a real rendered image — the gate delays, it never drops', async () => {
    const f = await manyIconFixture(6);
    const { Jimp } = await import('jimp');
    const hits = await Promise.all([...Array(6).keys()].map((i) => f.store.resolveRendered(`icon-${i}`)));
    expect(hits.every((h) => h !== null)).toBe(true);
    expect(new Set(hits.map((h) => h.absolutePath)).size).toBe(6);
    for (const h of hits) {
      // eslint-disable-next-line no-await-in-loop
      expect((await Jimp.read(h.absolutePath)).bitmap.width).toBe(96);
    }
  });

  it('hands the loop back between renders, so other work is not starved behind the whole burst', async () => {
    const f = await manyIconFixture(6);
    let ticks = 0;
    let running = true;
    const tick = () => { if (running) { ticks += 1; setImmediate(tick); } };
    setImmediate(tick);
    await Promise.all([...Array(6).keys()].map((i) => f.store.resolveRendered(`icon-${i}`)));
    running = false;
    // Without the yield the six renders queue back-to-back and an interleaved
    // task gets a handful of turns; with it, it keeps running throughout.
    expect(ticks).toBeGreaterThan(6);
  });
});

describe('IconManifestStore.warmCache', () => {
  async function warmFixture(count) {
    const { Jimp } = await import('jimp');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-warm-'));
    const mediaRoot = path.join(root, 'media');
    const dir = 'img/nutrition/icons/vegetables';
    fs.mkdirSync(path.join(mediaRoot, dir), { recursive: true });
    const icons = {};
    for (let i = 0; i < count; i += 1) {
      const rel = `${dir}/warm-${i}.png`;
      // eslint-disable-next-line no-await-in-loop
      fs.writeFileSync(path.join(mediaRoot, rel), await new Jimp({
        width: 150, height: 150, color: (0x0a0b0cff + i * 0x00020200) >>> 0,
      }).getBuffer('image/png'));
      icons[`warm-${i}`] = { path: rel };
    }
    const cacheDir = path.join(root, 'data/household/apps/health/icon-cache');
    const renders = [];
    const logger = {
      ...silent,
      debug: (event, data) => { if (event === 'health.icons.render.cached') renders.push(data); },
    };
    return {
      root, mediaRoot, cacheDir,
      renders: () => renders,
      store: new IconManifestStore({
        dataService: {
          household: {
            read: () => ({ icons, aliases: {} }),
            resolveDir: (p) => path.join(root, 'data/household', p),
          },
        },
        mediaRoot,
        logger,
      }),
    };
  }

  const cachedCount = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);

  it('renders every offered icon so a later request is warm', async () => {
    const f = await warmFixture(4);
    expect(cachedCount(f.cacheDir)).toBe(0);
    const summary = await f.store.warmCache({ pauseMs: 0 });
    expect(summary.warmed).toBe(4);
    expect(summary.failed).toBe(0);
    expect(cachedCount(f.cacheDir)).toBe(4);
  });

  it('is idempotent: a second pass renders nothing and reports them already cached', async () => {
    const f = await warmFixture(3);
    await f.store.warmCache({ pauseMs: 0 });
    expect(f.renders()).toHaveLength(3);
    const second = await f.store.warmCache({ pauseMs: 0 });
    expect(f.renders()).toHaveLength(3); // no new decodes
    expect(second.alreadyCached).toBe(3);
    expect(second.warmed).toBe(0);
  });

  it('gives up on its budget rather than running unbounded', async () => {
    const f = await warmFixture(6);
    const summary = await f.store.warmCache({ budgetMs: -1, pauseMs: 0 });
    expect(summary.gaveUp).toBe(true);
    expect(summary.warmed).toBe(0);
  });

  it('an unrenderable icon is reported as such, never thrown, and the pass continues', async () => {
    const f = await warmFixture(3);
    fs.writeFileSync(path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/warm-1.png'), 'not a png');
    const summary = await f.store.warmCache({ pauseMs: 0 });
    // The bad one falls back to its source, so it is a HIT but not a warm cache
    // entry. Counting it as warmed would report a warm cache that is not there.
    expect(summary.warmed).toBe(2);
    expect(summary.unrenderable).toBe(1);
    expect(cachedCount(f.cacheDir)).toBe(2);
  });

  it('does nothing (and does not throw) with no cache directory configured', async () => {
    const { store } = fixture(BASE_MANIFEST);
    await expect(store.warmCache({ pauseMs: 0 })).resolves.toMatchObject({ warmed: 0 });
  });
});

// Falling back to the source when rendering is impossible looked safe — an icon
// is decoration, so serve something. It is not: the sources average ~3 MB, so a
// broken cache silently re-creates the defect the renderer exists to fix. Seen
// for real during this work: 124 consecutive EACCES failures on the cache
// directory, each shipping a multi-megabyte PNG, one of them 6.7 MB, announced
// only by a warn among 124 identical ones.
describe('IconManifestStore refuses to ship an unrendered multi-megabyte source', () => {
  async function sourceFixture({ bytes, cacheWritable, decodable = true }) {
    const { Jimp } = await import('jimp');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-refuse-'));
    const mediaRoot = path.join(root, 'media');
    const rel = 'img/nutrition/icons/vegetables/big.png';
    fs.mkdirSync(path.dirname(path.join(mediaRoot, rel)), { recursive: true });
    const content = decodable
      ? await new Jimp({ width: 400, height: 400, color: 0x336699ff }).getBuffer('image/png')
      : Buffer.alloc(bytes ?? 1024, 0x41);
    const padded = bytes && content.length < bytes
      ? Buffer.concat([content, Buffer.alloc(bytes - content.length, 0)])
      : content;
    fs.writeFileSync(path.join(mediaRoot, rel), padded);

    const errors = [];
    const logger = { ...silent, error: (event, data) => errors.push({ event, data }) };
    const dataService = {
      household: {
        read: () => ({ icons: { big: { path: rel } }, aliases: {} }),
        ...(cacheWritable === null
          ? {}
          : { resolveDir: (p) => path.join(root, cacheWritable ? 'data/household' : 'nope/household', p) }),
      },
    };
    if (cacheWritable === false) {
      // A directory that exists but cannot be written into — the EACCES shape.
      const dir = path.join(root, 'nope/household', RENDER_CACHE_DIR_FOR_TEST);
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, 0o500);
    }
    return {
      root, mediaRoot, errors,
      sourceBytes: fs.statSync(path.join(mediaRoot, rel)).size,
      store: new IconManifestStore({ dataService, mediaRoot, logger }),
    };
  }
  const RENDER_CACHE_DIR_FOR_TEST = 'apps/health/icon-cache';

  it('refuses, loudly, when no cache directory is configured and the source is large', async () => {
    const f = await sourceFixture({ bytes: 3 * 1024 * 1024, cacheWritable: null });
    expect(f.sourceBytes).toBeGreaterThan(1024 * 1024);
    expect(await f.store.resolveRendered('big')).toBeNull();
    expect(f.errors.map((e) => e.event)).toContain('health.icons.render.unavailable');
    expect(f.errors[0].data.reason).toBe('NO_CACHE_DIR');
  });

  it('refuses when the cache directory cannot be written and the source is large', async () => {
    const f = await sourceFixture({ bytes: 3 * 1024 * 1024, cacheWritable: false });
    expect(await f.store.resolveRendered('big')).toBeNull();
    expect(f.errors.map((e) => e.event)).toContain('health.icons.render.unavailable');
    expect(f.errors[0].data.reason).toBe('RENDER_FAILED');
  });

  it('refuses an undecodable LARGE source rather than shipping it whole', async () => {
    const f = await sourceFixture({ bytes: 2 * 1024 * 1024, cacheWritable: true, decodable: false });
    expect(await f.store.resolveRendered('big')).toBeNull();
    expect(f.errors.map((e) => e.event)).toContain('health.icons.render.unavailable');
  });

  // The legacy flat vocabulary is ~4 KB per file. Those must keep working when
  // the cache is unavailable — refusing everything would black out 267 aliases
  // over a problem that only concerns the hi-res half.
  it('still serves a SMALL source unrendered, so the legacy vocabulary survives a broken cache', async () => {
    const f = await sourceFixture({ bytes: null, cacheWritable: null, decodable: false });
    expect(f.sourceBytes).toBeLessThan(64 * 1024);
    const hit = await f.store.resolveRendered('big');
    expect(hit).not.toBeNull();
    expect(hit.absolutePath).toBe(path.join(f.mediaRoot, 'img/nutrition/icons/vegetables/big.png'));
    expect(f.errors).toEqual([]);
  });
});
