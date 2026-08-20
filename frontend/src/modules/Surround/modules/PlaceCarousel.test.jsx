import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, fireEvent } from '@testing-library/react';
import * as sass from 'sass-embedded';
import PlaceCarousel, { PLACE_SLIDE_MS, PLACE_FADE_MS } from './PlaceCarousel.jsx';
import { COMPOSER_FACT_FADE_MS } from './ComposerCard.jsx';
import { CUE_FADE_MS } from './CueTicker.jsx';
import { DISSOLVE_FADE_MS, DISSOLVE_COMMIT_MS } from '../dissolve.js';
import { __resetMapCache } from '../map/CountryMap.jsx';
import { registerSurroundBuiltins, SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry, resetSurroundRegistry } from '../registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

/** Two squares, so the map slide has something to draw and a neighbour to name. */
const square = (name, lon0, lat0, lon1, lat1) => ({
  type: 'Feature',
  properties: { name },
  geometry: {
    type: 'Polygon',
    coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]],
  },
});
const GEO = {
  type: 'FeatureCollection',
  features: [square('Italy', 7, 37, 18, 47), square('Austria', 9, 46, 17, 49)],
};

// Vivaldi again — the same fixture the card and the placard are written against,
// so the three modules are demonstrably reading one payload.
const DATA = {
  contentId: 'plex:663146',
  assetBase: 'surround/classical',
  composer: {
    name: 'Antonio Vivaldi',
    portrait: 'vivaldi/portrait.jpg',
    city_image: 'vivaldi/venice.jpg',
    map: { country: 'Italy', city: 'Venice', lat: 45.44, lon: 12.33 },
  },
};

const withComposer = (composer) => ({ ...DATA, composer });

let fetchMock;

beforeEach(() => {
  __resetMapCache();
  resetSurroundRegistry();
  registerSurroundBuiltins();
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GEO) }));
  global.fetch = fetchMock;
});
afterEach(() => { resetSurroundRegistry(); __resetMapCache(); });

const props = (data, logger, position = 0) => ({
  position, duration: 3223, playing: true, seeking: false,
  data, region: { module: 'place-carousel', height: 300 }, logger,
});

const renderCarousel = ({ data = DATA, logger = makeLogger(), position = 0 } = {}) => {
  const view = render(<PlaceCarousel {...props(data, logger, position)} />);
  return {
    ...view,
    logger,
    at: (p) => view.rerender(<PlaceCarousel {...props(data, logger, p)} />),
    slide: () => view.container.querySelector('[data-testid="surround-place-slide"]'),
    kind: () => view.container.querySelector('[data-testid="surround-place-carousel"]')?.getAttribute('data-slide') ?? null,
    caption: () => view.container.querySelector('[data-testid="surround-place-caption"]'),
  };
};

/**
 * `CountryMap` fires its fetch from inside a promise chain, so an assertion made
 * straight after render ("asked for no geodata") would pass even if the map HAD
 * mounted. Drain the microtask queue first or the assertion is vacuous.
 */
const settle = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

describe('PlaceCarousel — registration', () => {
  it('is registered under the name the sidecar authors, for the rail', () => {
    expect(getSurroundRegistry().has('place-carousel')).toBe(true);
    expect(SURROUND_BUILTIN_MODULES).toContain('place-carousel');
    expect(getSurroundRegistry().getMeta('place-carousel')).toEqual({ regions: ['right'] });
    // Alongside, not instead of, everything already there — including the
    // standalone `country-map`, which stays registered for definitions that
    // want a bare map in a region of its own.
    for (const name of ['composer-card', 'country-map', 'cue-ticker', 'segment-map', 'work-placard']) {
      expect(getSurroundRegistry().has(name)).toBe(true);
    }
  });

  it('renders through the fixed module contract, from the registry', () => {
    const Module = getSurroundRegistry().get('place-carousel');
    const { container } = render(<Module {...props(DATA, makeLogger())} />);
    expect(container.querySelector('[data-testid="surround-place-carousel"]')).toBeTruthy();
  });
});

describe('PlaceCarousel — the slides', () => {
  it('opens on the city photograph, built through the static image route', () => {
    const view = renderCarousel();
    expect(view.kind()).toBe('photo');
    expect(view.getByTestId('surround-place-photo').getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/vivaldi/venice.jpg`);
  });

  it('captions the photograph with the city name, set as a label', () => {
    const view = renderCarousel();                 // fixture: map.city, no caption
    expect(view.caption().textContent).toBe('Venice');
    expect(view.caption().className).toContain('surround-place-carousel__caption--label');
  });

  it('prefers an authored caption, and sets it as prose', () => {
    const composer = {
      ...DATA.composer,
      map: { ...DATA.composer.map, caption: 'Venice — his lifelong home' },
    };
    const view = renderCarousel({ data: withComposer(composer) });
    expect(view.caption().textContent).toBe('Venice — his lifelong home');
    expect(view.caption().className).toContain('surround-place-carousel__caption--sentence');
  });

  it('treats a blank caption as unauthored rather than printing an empty line', () => {
    const composer = { ...DATA.composer, map: { ...DATA.composer.map, caption: '   ' } };
    const view = renderCarousel({ data: withComposer(composer) });
    expect(view.caption().textContent).toBe('Venice');
  });

  it('captions nothing when the photograph has neither caption nor city', () => {
    const composer = { ...DATA.composer, map: { country: 'Italy' } };
    const view = renderCarousel({ data: withComposer(composer) });
    expect(view.kind()).toBe('photo');
    expect(view.caption()).toBeNull();
  });

  it('shows the map as its second slide, captioned by the country alone', () => {
    // Drive to the map slide the way the dwell would, without waiting 12s.
    vi.useFakeTimers();
    try {
      const view = renderCarousel();
      act(() => { vi.advanceTimersByTime(PLACE_SLIDE_MS); });
      act(() => { vi.advanceTimersByTime(DISSOLVE_COMMIT_MS); });
      expect(view.kind()).toBe('map');
      // Design wave 5: COUNTRY-SCOPED. The regional slide draws no star and no
      // city name, so a caption naming the city would answer the NEXT slide's
      // question over this one's picture.
      expect(view.caption().textContent).toBe('Italy');
      expect(view.caption().className).toContain('surround-place-carousel__caption--label');
    } finally {
      vi.useRealTimers();
    }
  });

  it('captions the map with the country alone when no city is pinned', async () => {
    const composer = { ...DATA.composer, city_image: undefined, map: { country: 'Italy' } };
    const view = renderCarousel({ data: withComposer(composer) });
    await waitFor(() => expect(view.kind()).toBe('map'));
    expect(view.caption().textContent).toBe('Italy');
  });

  it('draws the real map, not a placeholder, on the map slide', async () => {
    const composer = { ...DATA.composer, city_image: undefined };
    const { container } = renderCarousel({ data: withComposer(composer) });
    await waitFor(() => expect(container.querySelector('[data-country="Italy"]')).toBeTruthy());
    expect(container.querySelector('[data-country="Italy"]').getAttribute('data-role')).toBe('highlight');
    // The COUNTRY's own name carries the regional slide; the city's star and
    // label belong to the slide after it (design wave 5).
    expect(container.querySelector('[data-country-label="Italy"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="country-map-label"]')).toBeNull();
  });

  /**
   * Design wave 4 — TWO MAPS. Having shown WHERE the country is, the third
   * slide shows where in it. Same `CountryMap`, one `zoom` prop: the geography
   * stays in `map/` rather than sprouting a second component that would have to
   * be kept in step with the first.
   */
  /**
   * Fake timers must be installed BEFORE the render: the dwell interval is
   * armed in an effect, and a real interval created first is invisible to fake
   * timers installed after it (the slide then never advances and the assertion
   * reads whatever slide 0 is). `flush` drains the geodata promise chain, which
   * is microtasks only and therefore still runs under fake timers.
   */
  const stepped = async (steps, data = DATA) => {
    vi.useFakeTimers();
    const flush = async () => {
      for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
    };
    const view = renderCarousel({ data });
    await flush();
    for (let i = 0; i < steps; i += 1) {
      act(() => { vi.advanceTimersByTime(PLACE_SLIDE_MS); });
      act(() => { vi.advanceTimersByTime(DISSOLVE_COMMIT_MS); });
      await flush();
    }
    vi.useRealTimers();
    return view;
  };

  it('adds a zoomed CITY map as its third slide, captioned by the city alone', async () => {
    const view = await stepped(2);
    expect(view.kind()).toBe('city-map');
    // The city LEADS on its own slide — that is what the slide is about.
    expect(view.caption().textContent).toBe('Venice');
    expect(view.caption().className).toContain('surround-place-carousel__caption--label');
  });

  it('frames the two map slides differently — region, then city', async () => {
    const map = (view) => view.container.querySelector('[data-testid="country-map"]');
    const region = map(await stepped(1));
    const city = map(await stepped(2));
    expect(region).toBeTruthy();
    expect(city).toBeTruthy();
    expect(region.getAttribute('data-zoom')).toBe('region');
    expect(city.getAttribute('data-zoom')).toBe('city');

    // Not merely a different label: the city slide is genuinely tighter. The
    // viewBox's third number IS the frame's span in degrees. Design wave 5
    // widened the regional frame (the city frame is now 35% of it, where it
    // used to be 59%) precisely because the old difference was one the viewer
    // could not see — this bound fails against wave 4's pads.
    const span = (svg) => parseFloat(svg.getAttribute('viewBox').split(/\s+/)[2]);
    expect(span(city)).toBeLessThan(span(region) * 0.45);
  });

  /**
   * Design wave 5 — THE TWO SLIDES GET DISTINCT JOBS. Seen live with Vienna,
   * the two maps read as the same picture twice. They are now answering
   * visibly different questions, and the star is the clearest tell: the
   * regional slide draws none at all, the city slide draws one with the city's
   * name beside it. Asserted on the same payload, so only the SLIDE differs.
   */
  it('points at no city on the regional slide, and at one on the city slide', async () => {
    const region = await stepped(1);
    expect(
      region.container.querySelector('[data-testid="country-map-marker"]'),
      'the regional slide is pointing at Venice — that is the next slide\'s answer',
    ).toBeNull();
    expect(region.container.querySelector('[data-testid="country-map-label"]')).toBeNull();

    const city = await stepped(2);
    expect(city.container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy();
    expect(city.container.querySelector('[data-testid="country-map-label"]').textContent).toBe('Venice');
  });

  it('skips the city map when no city is pinned — it would be the country slide again', async () => {
    const composer = { ...DATA.composer, city_image: undefined, map: { country: 'Italy' } };
    const view = renderCarousel({ data: withComposer(composer) });
    await waitFor(() => expect(view.kind()).toBe('map'));
    expect(view.container.querySelector('[data-testid="surround-place-carousel"]')
      .getAttribute('data-slides')).toBe('1');
  });

  it('hides a broken photograph and warns, without taking the slot down with it', () => {
    const view = renderCarousel();
    const img = view.getByTestId('surround-place-photo');
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
    expect(view.caption().textContent).toBe('Venice');
    const warned = view.logger.warn.mock.calls.find((c) => c[0] === 'surround.asset.missing');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663146', ref: 'vivaldi/venice.jpg' });
  });
});

/**
 * The module contract's null discipline, which this module has more chances to
 * break than most: it has TWO optional sources and could plausibly render a mat
 * with nothing in it, or a caption with no picture. It renders nothing at all.
 */
describe('PlaceCarousel — nothing to show', () => {
  it('renders no element, and asks for no geodata, when the composer has neither', async () => {
    const cases = [
      withComposer({ name: 'Anon.' }),                                   // no image, no map
      withComposer({ name: 'Anon.', map: { city: 'Nowhere' } }),         // a city, but no country
      { ...DATA, composer: undefined },
      null,
    ];
    for (const data of cases) {
      let view;
      expect(() => { view = renderCarousel({ data }); }).not.toThrow();
      expect(view.container.innerHTML).toBe('');
      await settle();
      expect(view.container.innerHTML).toBe('');
      view.unmount();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders no element when the payload names no assetBase and no country', async () => {
    const data = { ...DATA, assetBase: undefined, composer: { ...DATA.composer, map: { city: 'Venice' } } };
    const view = renderCarousel({ data });
    await settle();
    expect(view.container.innerHTML).toBe('');
  });
});

/**
 * The dwell. The rail is IDENTITY, not progress: it cycles whether or not the
 * transport is running, and the clock props it is handed change nothing.
 */
describe('PlaceCarousel — the dwell', () => {
  const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('holds each slide for the dwell, then dissolves to the next and wraps', () => {
    const view = renderCarousel();
    // Wave 4: three slides, in the order the place is actually explained —
    // the city, then where the country is, then where the city is in it.
    expect(view.kind()).toBe('photo');

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('map');

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('city-map');

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('photo');
  });

  it('dissolves through the dark: the old slide holds, hidden, before the swap', () => {
    const view = renderCarousel();

    tick(PLACE_SLIDE_MS);
    // Mid-choreography: the OLD slide is still mounted and faded out. The slot
    // has not gone empty and nothing has resized.
    expect(view.kind()).toBe('photo');
    expect(view.slide().className).toContain('surround-place-carousel__slide--hidden');

    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('map');
    expect(view.slide().className).not.toContain('surround-place-carousel__slide--hidden');
  });

  it('drives the CSS fade from the same constant as the JS timer', () => {
    const view = renderCarousel();
    expect(view.slide().style.transition).toBe(`opacity ${PLACE_FADE_MS}ms ease`);
  });

  // The brief's "single-source the constant": this module, the rail's fact
  // rotation and the band's cue line must play ONE dissolve. Asserting the
  // numbers are equal is weaker than asserting they are the same constant, so
  // both are checked — equality here, identity via the shared import.
  it('plays the same dissolve as the composer fact and the cue line', () => {
    expect(PLACE_FADE_MS).toBe(DISSOLVE_FADE_MS);
    expect(COMPOSER_FACT_FADE_MS).toBe(DISSOLVE_FADE_MS);
    expect(CUE_FADE_MS).toBe(DISSOLVE_FADE_MS);
  });

  it('does not cycle when there is only one slide to show', () => {
    // Photo only.
    const photoOnly = renderCarousel({
      data: withComposer({ ...DATA.composer, map: { city: 'Venice' } }),
    });
    expect(photoOnly.kind()).toBe('photo');
    expect(vi.getTimerCount()).toBe(0);
    tick(PLACE_SLIDE_MS * 5);
    expect(photoOnly.kind()).toBe('photo');
    photoOnly.unmount();

    // Map only.
    const mapOnly = renderCarousel({
      data: withComposer({ ...DATA.composer, city_image: undefined }),
    });
    expect(mapOnly.kind()).toBe('map');
    tick(PLACE_SLIDE_MS * 5);
    expect(mapOnly.kind()).toBe('map');
  });

  it('is time-driven, not playhead-driven — position changes never advance it', () => {
    const view = renderCarousel();
    for (const p of [12, 400, 976, 1925, 2278, 3000]) view.at(p);
    expect(view.kind()).toBe('photo');

    // The same component, with the clock frozen, does advance on its own timer.
    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('map');
  });

  it('keeps cycling while the transport is paused — the rail is identity', () => {
    const logger = makeLogger();
    const paused = { ...props(DATA, logger), playing: false };
    const view = render(<PlaceCarousel {...paused} />);
    const kind = () => view.container.querySelector('[data-testid="surround-place-carousel"]').getAttribute('data-slide');

    expect(kind()).toBe('photo');
    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(kind()).toBe('map');
  });

  it('leaves no timer armed after unmount', () => {
    const view = renderCarousel();
    tick(PLACE_SLIDE_MS);                          // a fade timer is now pending too
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stands still under prefers-reduced-motion, with nothing armed at all', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    try {
      const view = renderCarousel();
      expect(view.kind()).toBe('photo');
      expect(vi.getTimerCount()).toBe(0);          // no dwell interval, no fade timeout
      tick(PLACE_SLIDE_MS * 4);
      expect(view.kind()).toBe('photo');
      expect(view.slide().className).not.toContain('surround-place-carousel__slide--hidden');
    } finally {
      window.matchMedia = original;
    }
  });

  it('logs each slide it shows', () => {
    const view = renderCarousel();
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.place-slide.shown');
    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toMatchObject({ contentId: 'plex:663146', kind: 'photo', of: 3 });

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(shown()[1][1]).toMatchObject({ kind: 'map', of: 3 });

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(shown()[2][1]).toMatchObject({ kind: 'city-map', of: 3 });
  });
});

/**
 * Fix round 1 (review finding): `index` never reset when the composer changed
 * under the carousel, so a new piece could open straight onto whatever slide
 * the PREVIOUS composer happened to be dwelling on — most reachable via the
 * map slide itself (a tap on it takes the surround to a different piece), so
 * "mid-cycle" is not a hypothetical.
 */
describe('PlaceCarousel — a new composer opens mid-cycle', () => {
  const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reopens on slide 0 when the content identity changes, even mid-cycle', () => {
    const logger = makeLogger();
    const view = renderCarousel({ logger });
    expect(view.kind()).toBe('photo');

    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('map');          // mid-cycle: dwelling on slide 1

    const NEXT = {
      contentId: 'plex:663200',
      assetBase: 'surround/classical',
      composer: {
        name: 'Clara Schumann',
        portrait: 'schumann/portrait.jpg',
        city_image: 'schumann/leipzig.jpg',
        map: { country: 'Italy', city: 'Rome', lat: 41.9, lon: 12.5 },
      },
    };
    view.rerender(<PlaceCarousel {...props(NEXT, logger, 0)} />);
    tick(DISSOLVE_COMMIT_MS);                 // let the swap to slide 0 settle
    expect(view.kind()).toBe('photo');
    expect(view.getByTestId('surround-place-photo').getAttribute('src')).toContain('leipzig.jpg');
  });

  it('does not reset the index on a mere clock tick — only a content change resets it', () => {
    const view = renderCarousel();
    tick(PLACE_SLIDE_MS);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.kind()).toBe('map');

    // Same composer, same contentId — just a later position. The reset effect
    // is keyed on content identity, not on the clock.
    view.at(999);
    expect(view.kind()).toBe('map');
  });
});

/**
 * The slot must not move when the slide changes — the same reserve contract the
 * fact rotations keep. Two things could break it: the two media having different
 * aspect ratios, and the caption's two registers having different heights.
 * Both are pinned against the SHIPPED stylesheet (compiled here rather than
 * hand-typed) because the vitest config runs `css: false`, so a plain render
 * would read UA defaults and pass whatever the SCSS said.
 */
describe('PlaceCarousel — the slot never moves', () => {
  let injectedStyle = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'PlaceCarousel.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);
    return compiled.css;
  };
  afterEach(() => { injectedStyle?.remove(); injectedStyle = null; });

  it('gives both slides the same 5:3 mat, so the swap is a dissolve not a resize', () => {
    withStyles();
    const { container } = renderCarousel();
    const mat = window.getComputedStyle(container.querySelector('.surround-place-carousel__mat'));
    expect(mat.getPropertyValue('aspect-ratio')).toBe('5 / 3');
    expect(mat.getPropertyValue('width')).toBe('100%');
  });

  it('reserves one caption box for both registers', () => {
    withStyles();
    const label = renderCarousel();                       // 'VENICE' — label register
    const sentence = renderCarousel({
      data: withComposer({
        ...DATA.composer,
        map: { ...DATA.composer.map, caption: 'Venice, where he was born and wrote for the orphanage orchestra' },
      }),
    });
    const box = (view) => {
      const s = window.getComputedStyle(view.caption());
      return [s.getPropertyValue('min-height'), s.getPropertyValue('max-height')];
    };
    expect(parseFloat(box(label)[0])).toBeGreaterThan(0);
    expect(box(label)).toEqual(box(sentence));
  });

  it("bans cover from the carousel's pictures outright", () => {
    // Comments survive compilation and could name the banned value, so strip
    // them before the search — otherwise this fails on its own rationale.
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/object-fit:\s*cover/);
    expect(css).toMatch(/object-fit:\s*contain/);
  });

  // Design wave 4: ONE dark mat, for every slide. Cream paper around a bright
  // city view read as a white border on a dark wall — the most distracting mark
  // on the screen. The dark mat also resolves wave 3's asymmetry (the map had
  // to skip the paper because parchment ink on parchment is invisible): a
  // near-black ground carries a photograph and an engraving equally, so the
  // GROUND is now part of the reserve too and the swap stays a pure dissolve.
  it('mounts every slide on the same dark mat, with a dark definition line', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const shared = css.match(/\.surround-place-carousel__mat \{([^}]*)\}/)?.[1] ?? '';
    expect(shared).toBeTruthy();
    expect(shared).toMatch(/background: var\(--mat,/);
    expect(shared).toMatch(/inset 0 0 0 1px var\(--mat-edge,/);
    // No picture in this module reads the paper token, and no variant re-grounds
    // the slot — that is what makes it ONE mat rather than two that agree today.
    expect(css).not.toMatch(/--programme/);
    expect(css).not.toMatch(/__mat--photo \{[^}]*background/);
    expect(css).not.toMatch(/__mat--map,?[^{]*\{[^}]*background:/);
  });

  // The map is drawn over the MAT now, not over the rail, so the one colour it
  // cannot derive — the ground its labels are haloed against — has to follow.
  it('re-points the map halo at the mat the map is actually drawn on', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/__mat--map,\s*\.surround-place-carousel__mat--city-map \{[^}]*--map-halo: var\(--mat,/);
  });

  // The caption was the hardest thing in the rail to read: `--ink-soft` on
  // maroon at 0.86rem. Full parchment ink, and both registers a size up.
  it('sets the caption in full ink, big enough to read across the room', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    // Full `--ink`, not the dim `--ink-soft` it used to carry. Asserted on the
    // compiled rule: happy-dom resolves the var to its literal fallback in
    // computed style, which would make the two tokens indistinguishable.
    expect(css).toMatch(/\.surround-place-carousel__caption \{[^}]*color: var\(--ink,/);
    expect(css).not.toMatch(/\.surround-place-carousel__caption \{[^}]*--ink-soft/);

    const label = renderCarousel();
    const style = window.getComputedStyle(label.caption());
    expect(parseFloat(style.getPropertyValue('font-size'))).toBeGreaterThanOrEqual(0.9 * 16);

    const sentence = renderCarousel({
      data: withComposer({
        ...DATA.composer,
        map: { ...DATA.composer.map, caption: 'Venice — his lifelong home' },
      }),
    });
    const prose = window.getComputedStyle(sentence.caption());
    expect(parseFloat(prose.getPropertyValue('font-size'))).toBeGreaterThanOrEqual(1 * 16);
    // Still a caption's register, not body copy.
    expect(prose.getPropertyValue('font-style')).toBe('italic');
  });

  it('marks which ground each slide is on, so the mat variant follows the slide', () => {
    const view = renderCarousel();
    expect(view.container.querySelector('.surround-place-carousel__mat').className)
      .toContain('surround-place-carousel__mat--photo');

    vi.useFakeTimers();
    try {
      const v = renderCarousel();
      act(() => { vi.advanceTimersByTime(PLACE_SLIDE_MS); });
      act(() => { vi.advanceTimersByTime(DISSOLVE_COMMIT_MS); });
      expect(v.container.querySelector('.surround-place-carousel__mat').className)
        .toContain('surround-place-carousel__mat--map');
    } finally {
      vi.useRealTimers();
    }
  });

  it('kills the dissolve entirely under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*__slide \{ transition: none/);
  });
});

/**
 * DESIGN WAVE 6 — THE FOURTH SLIDE: WHEN.
 *
 * The carousel has always asked where — the composer's city, the country in
 * continental context, the city inside it. The era timeline is the same kind of
 * question about a different axis, drawn on the same plate, in the same
 * engraved language, and it comes LAST because it is the only one that is not a
 * place.
 */
describe('PlaceCarousel — the era slide', () => {
  const WITH_PERIOD = {
    ...DATA,
    piece: {
      composed: '1803-1804',
      year: 1804,
      period: 'Classical to Romantic',
      period_note: 'Written at the hinge — Classical forms stretched to Romantic scale.',
    },
    composer: {
      ...DATA.composer,
      period: 'Classical',
      period_note: 'Clear forms and balanced phrases.',
    },
  };

  it('adds a fourth slide when a period resolves, after both maps', async () => {
    vi.useFakeTimers();
    try {
    const view = renderCarousel({ data: WITH_PERIOD });
    await settle();
    expect(view.container.querySelector('[data-testid="surround-place-carousel"]')
      .getAttribute('data-slides')).toBe('4');

    // photo -> region map -> city map -> era, in that order.
    const kinds = [];
    for (let i = 0; i < 4; i += 1) {
      kinds.push(view.kind());
      await act(async () => { vi.advanceTimersByTime(PLACE_SLIDE_MS); });
      await act(async () => { vi.advanceTimersByTime(DISSOLVE_COMMIT_MS + DISSOLVE_FADE_MS); });
    }
    expect(kinds).toEqual(['photo', 'map', 'city-map', 'era']);
    } finally { vi.useRealTimers(); }
  });

  it('has no era slide at all when neither the piece nor the composer names a period', async () => {
    const view = renderCarousel();
    await settle();
    expect(view.container.querySelector('[data-testid="surround-place-carousel"]')
      .getAttribute('data-slides')).toBe('3');
  });

  it('is the ONLY slide for a piece with a period and nothing else', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: { period: 'Baroque', year: 1725 }, composer: null },
    });
    await settle();
    expect(view.kind()).toBe('era');
    expect(view.container.querySelector('[data-testid="surround-era-timeline"]')).not.toBeNull();
  });

  it('prefers the piece’s period and note over the composer’s', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: WITH_PERIOD.piece, composer: { period: 'Classical', period_note: 'Clear forms and balanced phrases.' } },
    });
    await settle();
    expect(view.container.querySelector('[data-testid="surround-era-timeline"]')
      .getAttribute('data-subjects')).toBe('Classical,Romantic');
    expect(view.container.querySelector('[data-testid="surround-era-note"]'))
      .toHaveTextContent('Written at the hinge');
  });

  it('falls back to the composer’s period and note', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: { year: 1725 }, composer: { period: 'Baroque', period_note: 'Ornamented melody over a driving bass.' } },
    });
    await settle();
    expect(view.container.querySelector('[data-testid="surround-era-timeline"]')
      .getAttribute('data-subjects')).toBe('Baroque');
    expect(view.container.querySelector('[data-testid="surround-era-note"]'))
      .toHaveTextContent('Ornamented melody');
  });

  /**
   * THE CAPTION IS THE DATE, NOT THE ERA. The lit band, the brass marker and
   * the note all name the era, and the composer card six inches up the same
   * rail names it a fourth time (wave 6 §2): captioning the plate with it too
   * was measured on screen and read as a duplication bug. What the plate cannot
   * show is the precise dating the marker stands at.
   */
  it('captions the plate with the work’s dating, not with the era again', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: WITH_PERIOD.piece, composer: null },
    });
    await settle();
    expect(view.caption()).toHaveTextContent('1803-1804');
    expect(view.caption().textContent).not.toContain('Classical');
    // Same register as the country and the city labels — one voice.
    expect(view.caption().className).toContain('surround-place-carousel__caption--label');
  });

  it('captions with the year where no composition range is authored', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: { period: 'Baroque', year: 1725 }, composer: null },
    });
    await settle();
    expect(view.caption()).toHaveTextContent('1725');
  });

  it('falls back to the era for a piece that is dated nowhere at all', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: { period: 'Baroque' }, composer: null },
    });
    await settle();
    expect(view.caption()).toHaveTextContent('Baroque');
    // ...and there is no marker to point at a year nobody authored.
    expect(view.container.querySelector('[data-testid="surround-era-marker"]')).toBeNull();
  });

  it('keeps the slot’s geometry: the era plate is drawn in the same mat as the maps', async () => {
    const view = renderCarousel({
      data: { contentId: 'x', piece: WITH_PERIOD.piece, composer: null },
    });
    await settle();
    const mat = view.container.querySelector('.surround-place-carousel__mat');
    expect(mat.className).toContain('surround-place-carousel__mat--era');
    // The reserve is what makes the swap a dissolve rather than a resize: the
    // plate and its caption are the same two boxes on every slide.
    expect(mat.querySelector('.surround-place-carousel__era')).not.toBeNull();
    expect(view.caption()).not.toBeNull();
  });
});

describe('PlaceCarousel — smart quotes at the render seam (design wave 7)', () => {
  it('curls an authored caption', () => {
    const view = renderCarousel({
      data: {
        ...DATA,
        composer: {
          ...DATA.composer,
          map: { ...DATA.composer.map, caption: "Venice — the Republic's own city" },
        },
      },
    });
    expect(view.caption().textContent).toBe('Venice — the Republic’s own city');
    expect(view.caption().textContent).not.toContain("'");
  });
});
