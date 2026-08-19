import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import CountryMap, { __resetMapCache, RENDER_W, RENDER_H, LABEL_EM_PER_CHAR, LABEL_MARGIN_EM } from './CountryMap.jsx';

/**
 * A tiny stand-in for europe.geo.json. Three squares of very different size and
 * position — never the real 41 KB asset, which would make these tests a network
 * fixture rather than a unit test.
 *
 * Alpha straddles the equator on purpose: Mercator is ~conformal-and-linear
 * there, so a country that is square in degrees is also square in projected
 * units. That is what makes the "no stretching" assertion sharp.
 */
const square = (name, lon0, lat0, lon1, lat1) => ({
  type: 'Feature',
  properties: { name },
  geometry: {
    type: 'Polygon',
    coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]],
  },
});

/**
 * Natural Earth gives France its overseas départements, Norway its Arctic
 * islands and Russia Kamchatka. A country framed on its RAW bbox therefore comes
 * out as mostly ocean — measured against the real asset: France 116° wide,
 * Norway 145°, Russia 450° (wider than the planet). Delta is that shape in
 * miniature: a mainland with a far-flung island.
 */
const DELTA = {
  type: 'Feature',
  properties: { name: 'Delta' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[50, 0], [56, 0], [56, 6], [50, 6], [50, 0]]],       // mainland, 6°
      [[[120, 0], [121, 0], [121, 1], [120, 1], [120, 0]]],  // an island, 70° away
    ],
  },
};

const FIXTURE = {
  type: 'FeatureCollection',
  features: [
    square('Alpha', 0, -1, 2, 1),        // 2° x 2°, on the equator
    square('Beta', 10, 10, 30, 30),      // 20° x 20°, far away
    square('Gamma', -5, 40, -4, 41),     // 1° x 1°, far away the other way
    DELTA,
  ],
};

const makeLogger = () => {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  l.child = vi.fn(() => l);
  return l;
};

let fetchMock;

const okFetch = (body = FIXTURE) => vi.fn(() => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
}));

beforeEach(() => {
  __resetMapCache();
  fetchMock = okFetch();
  global.fetch = fetchMock;
});

afterEach(() => { vi.restoreAllMocks(); });

const renderMap = async (props = {}) => {
  const logger = props.logger ?? makeLogger();
  const utils = render(<CountryMap {...props} logger={logger} />);
  await waitFor(() => {
    // Either the map painted, or the component decided to render nothing.
    expect(fetchMock).toHaveBeenCalled();
  });
  return { ...utils, logger };
};

const svgOf = (container) => container.querySelector('[data-testid="country-map"]');
const pathOf = (container, name) => container.querySelector(`[data-country="${name}"]`);
/** The `<g>` carrying a country's NAME, if the map decided to write it. */
const labelFor = (container, name) => container.querySelector(`[data-country-label="${name}"]`);
const labelNames = (container) => [...container.querySelectorAll('[data-country-label]')]
  .map((el) => el.getAttribute('data-country-label'));

/** viewBox attribute -> { x, y, w, h }. */
const viewBoxOf = (container) => {
  const [x, y, w, h] = svgOf(container).getAttribute('viewBox').split(/\s+/).map(Number);
  return { x, y, w, h };
};

/** Extent of a path's own coordinates, read back out of its `d`. */
const extentOf = (pathEl) => {
  const nums = pathEl.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

describe('CountryMap', () => {
  // WAVE 3. Engraved, not filled. Wave 1 painted the subject a solid `--velvet`
  // and the context solid `--programme-edge`, which on the dark rail was two
  // stickers; the rail had to re-map `--velvet` just to keep them visible. Now
  // every shape is drawn in the frame's own ink family with washes faint enough
  // to tint rather than fill, and the line does the drawing — so the map is
  // restyled by the region it sits in and needs no token re-map at all.
  it('draws every country as an ink hairline over a wash, never a solid fill', async () => {
    const { container } = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(pathOf(container, 'Beta')).toBeTruthy());

    const beta = pathOf(container, 'Beta');
    expect(beta.getAttribute('data-role')).toBe('highlight');
    expect(beta.getAttribute('fill')).toContain('--ink');
    expect(beta.getAttribute('stroke')).toContain('--ink');
    // The subject is the loudest line and the strongest wash — and the wash is
    // still a wash: a fill opacity anywhere near 1 is the sticker coming back.
    const betaWash = Number(beta.getAttribute('fill-opacity'));
    expect(betaWash).toBeGreaterThan(0);
    expect(betaWash).toBeLessThan(0.3);

    for (const other of ['Alpha', 'Gamma']) {
      const el = pathOf(container, other);
      expect(el.getAttribute('data-role')).toBe('context');
      expect(el.getAttribute('stroke')).toContain('--ink-soft');
      // Quieter than the subject in both registers, so the eye sorts subject
      // from context before it reads a single label.
      expect(Number(el.getAttribute('fill-opacity'))).toBeLessThan(betaWash);
      expect(Number(el.getAttribute('stroke-width')))
        .toBeLessThan(Number(beta.getAttribute('stroke-width')));
    }
  });

  it('reads no --velvet anywhere: the rail re-map that propped it up is retired', async () => {
    const { container } = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(pathOf(container, 'Beta')).toBeTruthy());
    expect(svgOf(container).outerHTML).not.toContain('--velvet');
  });

  it('draws context countries beneath the highlight, and the marker above both', async () => {
    const { container } = await renderMap({ country: 'Beta', city: 'Betaville', lat: 20, lon: 20 });
    await waitFor(() => expect(pathOf(container, 'Beta')).toBeTruthy());

    const painted = [...svgOf(container).querySelectorAll('[data-role], [data-testid="country-map-marker"]')]
      .map((el) => el.getAttribute('data-role') ?? 'marker');
    expect(painted[painted.length - 1]).toBe('marker');
    expect(painted.indexOf('highlight')).toBeGreaterThan(painted.indexOf('context'));
  });

  // The core requirement: no per-country configuration, yet every country frames
  // itself. A fixed world viewBox would make these two identical.
  it('auto-frames: different countries produce different viewBoxes', async () => {
    const small = await renderMap({ country: 'Gamma' });
    await waitFor(() => expect(pathOf(small.container, 'Gamma')).toBeTruthy());
    const big = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(pathOf(big.container, 'Beta')).toBeTruthy());

    const vbSmall = viewBoxOf(small.container);
    const vbBig = viewBoxOf(big.container);

    expect(svgOf(small.container).getAttribute('viewBox'))
      .not.toBe(svgOf(big.container).getAttribute('viewBox'));
    // Gamma is 1°, Beta is 20°: the frames must differ by roughly that ratio.
    expect(vbBig.w).toBeGreaterThan(vbSmall.w * 5);
    // And they are centred on different places.
    expect(Math.abs(vbBig.x - vbSmall.x)).toBeGreaterThan(1);
  });

  /**
   * WAVE 3, and the whole point of the redesign. The user's verdict on the old
   * framing was "Austria with Vienna, no country name, no neighbours, no
   * context" — a share of ~0.8 answered "what shape is this country?" and
   * refused "where is it?". The subject now spans about HALF its frame: still
   * unmistakably the subject, with the other half available for the countries
   * around it. Both bounds are load-bearing — the upper one is the defect this
   * wave fixes, the lower one stops a later tweak from losing the subject.
   */
  it('auto-frames at regional zoom: the subject is about half its frame, not all of it', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      __resetMapCache();
      global.fetch = okFetch();
      fetchMock = global.fetch;
      const { container } = await renderMap({ country: name });
      await waitFor(() => expect(pathOf(container, name)).toBeTruthy());
      const vb = viewBoxOf(container);
      const ext = extentOf(pathOf(container, name));
      const share = Math.max(ext.w / vb.w, ext.h / vb.h);
      expect(share, `${name} fills ${share} of its frame — no room for neighbours`)
        .toBeLessThan(0.7);
      expect(share, `${name} fills only ${share} of its frame — it is not the subject`)
        .toBeGreaterThan(0.35);
    }
  });

  /**
   * Design wave 4 — TWO ZOOMS, ONE COMPONENT.
   *
   * The place carousel shows this map twice: once to answer "where is that
   * country" and once to answer "where in it is the city". That is a framing
   * decision, not a second map, so it is one `zoom` prop over the same
   * geography rather than a `CityMap` that would have to be kept in step.
   *
   * The two bounds are both load-bearing. The upper one is what makes the city
   * zoom actually zoomed (the defect it prevents is two slides that look the
   * same); the lower one stops a later tweak cropping the subject off its own
   * frame — the country's SHAPE is still the subject at this zoom.
   */
  it('frames the subject nearly edge to edge at zoom="city"', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      __resetMapCache();
      global.fetch = okFetch();
      fetchMock = global.fetch;
      const { container } = await renderMap({ country: name, zoom: 'city' });
      await waitFor(() => expect(pathOf(container, name)).toBeTruthy());
      const vb = viewBoxOf(container);
      const ext = extentOf(pathOf(container, name));
      const share = Math.max(ext.w / vb.w, ext.h / vb.h);
      expect(share, `${name} fills only ${share} of its frame — this is not a zoom`)
        .toBeGreaterThan(0.8);
      expect(share, `${name} fills ${share} of its frame — it is cropped, not framed`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('leaves the regional zoom as the default, and falls back to it for an unknown one', async () => {
    const spans = {};
    for (const zoom of [undefined, 'region', 'city', 'nonsense']) {
      __resetMapCache();
      global.fetch = okFetch();
      fetchMock = global.fetch;
      const props = zoom === undefined ? { country: 'Alpha' } : { country: 'Alpha', zoom };
      const { container } = await renderMap(props);
      await waitFor(() => expect(pathOf(container, 'Alpha')).toBeTruthy());
      spans[String(zoom)] = viewBoxOf(container).w;
      // The rendered zoom is published, so a consumer (and the carousel's test)
      // can tell the two slides apart without re-deriving the framing.
      expect(container.querySelector('[data-testid="country-map"]').getAttribute('data-zoom'))
        .toBe(zoom === 'city' ? 'city' : 'region');
    }
    expect(spans.undefined).toBe(spans.region);
    expect(spans.nonsense).toBe(spans.region);   // never an undefined pad
    expect(spans.city).toBeLessThan(spans.region);
  });

  it('shows the neighbours: a country adjacent to the subject lands inside the frame', async () => {
    // Alpha (0..2 lon) with Epsilon starting 1° east of it. At wave 1's PAD the
    // frame stopped at ~2.25 and Epsilon was off-screen entirely; at regional
    // zoom it is drawn AND named.
    __resetMapCache();
    global.fetch = okFetch({
      type: 'FeatureCollection',
      features: [square('Alpha', 0, -1, 2, 1), square('Epsilon', 3, -1, 5, 1)],
    });
    fetchMock = global.fetch;
    const { container } = await renderMap({ country: 'Alpha' });
    await waitFor(() => expect(pathOf(container, 'Alpha')).toBeTruthy());

    const vb = viewBoxOf(container);
    expect(vb.x + vb.w, 'the frame does not reach the neighbour at all').toBeGreaterThan(4);
    expect(labelFor(container, 'Epsilon'), 'the visible neighbour went unnamed').toBeTruthy();
  });

  it('preserves aspect ratio: a square country stays square', async () => {
    const { container } = await renderMap({ country: 'Alpha' });
    await waitFor(() => expect(pathOf(container, 'Alpha')).toBeTruthy());

    // The country's own drawn extent must stay square...
    const ext = extentOf(pathOf(container, 'Alpha'));
    expect(ext.w / ext.h).toBeCloseTo(1, 1);

    // ...which only holds if the viewBox matches the render box's aspect, so the
    // frame letterboxes rather than stretching to fill.
    const vb = viewBoxOf(container);
    expect(vb.w / vb.h).toBeCloseTo(RENDER_W / RENDER_H, 3);
    expect(svgOf(container).getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('places the city marker, and flips its label away from the right edge', async () => {
    const centred = await renderMap({ country: 'Beta', city: 'Middle', lat: 20, lon: 20 });
    await waitFor(() => expect(centred.container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy());
    expect(centred.container.querySelector('[data-testid="country-map-label"]').textContent).toBe('Middle');
    expect(centred.container.querySelector('[data-testid="country-map-label"]').getAttribute('text-anchor')).toBe('start');

    // At regional zoom the frame is much wider than the country, so "near the
    // right edge" is a property of the FRAME, not of Beta. Read the frame the
    // first render produced and put the second city at 80% across it, rather
    // than hard-coding a longitude that PAD would invalidate.
    const vb = viewBoxOf(centred.container);
    __resetMapCache();
    global.fetch = okFetch();
    fetchMock = global.fetch;
    const rightEdge = await renderMap({
      country: 'Beta', city: 'Eastward', lat: 20, lon: vb.x + vb.w * 0.8,
    });
    await waitFor(() => expect(rightEdge.container.querySelector('[data-testid="country-map-label"]')).toBeTruthy());
    expect(rightEdge.container.querySelector('[data-testid="country-map-label"]').getAttribute('text-anchor')).toBe('end');
  });

  it('renders the marker in brass at a legible size', async () => {
    const { container } = await renderMap({ country: 'Beta', city: 'Betaville', lat: 20, lon: 20 });
    await waitFor(() => expect(container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy());
    const star = container.querySelector('[data-testid="country-map-star"]');
    expect(star.getAttribute('fill')).toContain('--brass');
    const label = container.querySelector('[data-testid="country-map-label"]');
    expect(label.getAttribute('fill')).toContain('--brass');
    // The marker group is scaled by (view units per px), so its own font-size
    // attribute is already in rendered pixels. Design floor: 0.72rem.
    const vb = viewBoxOf(container);
    const marker = container.querySelector('[data-testid="country-map-marker"]');
    const scale = Number(marker.getAttribute('transform').match(/scale\(([-\d.]+)\)/)[1]);
    expect(scale).toBeCloseTo(vb.w / RENDER_W, 2);
    expect(Number(label.getAttribute('font-size'))).toBeGreaterThanOrEqual(0.72 * 16);
  });

  it('frames the landmass the city is on, not the overseas territories', async () => {
    const { container } = await renderMap({ country: 'Delta', city: 'Mainville', lat: 3, lon: 53 });
    await waitFor(() => expect(pathOf(container, 'Delta')).toBeTruthy());
    const vb = viewBoxOf(container);

    // Raw-bbox framing would span the 71° out to the island; the mainland is 6°.
    expect(vb.w).toBeLessThan(20);
    expect(vb.x).toBeGreaterThan(40);
    // The island is still DRAWN — it is only excluded from the framing decision.
    expect(pathOf(container, 'Delta').getAttribute('d')).toContain('120');
    // And the marker still lands inside the frame.
    const m = container.querySelector('[data-testid="country-map-marker"]');
    const mx = Number(m.getAttribute('transform').match(/translate\((-?[\d.]+)/)[1]);
    expect(mx).toBeGreaterThan(vb.x);
    expect(mx).toBeLessThan(vb.x + vb.w);
  });

  it('falls back to the largest landmass when no city is given', async () => {
    const { container } = await renderMap({ country: 'Delta' });
    await waitFor(() => expect(pathOf(container, 'Delta')).toBeTruthy());
    const vb = viewBoxOf(container);
    expect(vb.w).toBeLessThan(20);
    expect(vb.x).toBeGreaterThan(40); // the 6° mainland, not the 1° island
  });

  it('an unknown country still renders the context map, warns, and does not throw', async () => {
    const logger = makeLogger();
    const { container } = await renderMap({ country: 'Atlantis', logger });
    await waitFor(() => expect(pathOf(container, 'Alpha')).toBeTruthy());

    expect(container.querySelector('[data-role="highlight"]')).toBeNull();
    expect([...container.querySelectorAll('[data-role="context"]')]).toHaveLength(4);
    expect(logger.warn).toHaveBeenCalledWith('surround.map.country-missing', { country: 'Atlantis' });
  });

  it('an unknown country still centres on the city when one is given', async () => {
    const logger = makeLogger();
    const { container } = await renderMap({ country: 'Atlantis', city: 'Nowhere', lat: 20, lon: 20, logger });
    await waitFor(() => expect(container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy());
    const vb = viewBoxOf(container);
    expect(20).toBeGreaterThan(vb.x);
    expect(20).toBeLessThan(vb.x + vb.w);
    expect(logger.warn).toHaveBeenCalledWith('surround.map.country-missing', { country: 'Atlantis' });
  });

  it('renders the map with no marker when lat/lon are missing', async () => {
    const { container } = await renderMap({ country: 'Beta', city: 'Betaville' });
    await waitFor(() => expect(pathOf(container, 'Beta')).toBeTruthy());
    expect(container.querySelector('[data-testid="country-map-marker"]')).toBeNull();
    expect(svgOf(container)).toBeTruthy();
  });

  it('renders nothing and warns when the geodata cannot be fetched', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    fetchMock = global.fetch;
    const logger = makeLogger();
    const { container } = await renderMap({ country: 'Beta', logger });
    await waitFor(() => expect(logger.warn).toHaveBeenCalledWith('surround.map.load-failed', { error: 'offline' }));
    expect(svgOf(container)).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('fetches the geodata once no matter how many cards mount', async () => {
    await renderMap({ country: 'Alpha' });
    await renderMap({ country: 'Beta' });
    await renderMap({ country: 'Gamma' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the static media route for the shared geodata', async () => {
    await renderMap({ country: 'Alpha' });
    expect(String(fetchMock.mock.calls[0][0]))
      .toContain('/api/v1/static/img/surround/_maps/europe.geo.json');
  });
});

/**
 * WAVE 3 — the map names what it draws.
 *
 * "No country name, no neighbours, no context" was three quarters of the user's
 * verdict on the old render. Zooming out (above) supplies the neighbours;
 * these specs are the naming. Two registers, one voice: the subject loud, the
 * neighbours quiet, and neither ever below the 0.72rem ten-foot floor.
 */
describe('CountryMap labels', () => {
  it('names the subject country as the map\'s primary label', async () => {
    const { container } = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(labelFor(container, 'Beta')).toBeTruthy());

    const label = labelFor(container, 'Beta');
    expect(label.getAttribute('data-role')).toBe('subject');
    expect(label.querySelector('text').textContent).toBe('Beta');
    expect(label.querySelector('text').getAttribute('fill')).toContain('--ink');
  });

  it('names visible neighbours more quietly than the subject', async () => {
    __resetMapCache();
    global.fetch = okFetch({
      type: 'FeatureCollection',
      features: [square('Alpha', 0, -1, 2, 1), square('Epsilon', 3, -1, 5, 1)],
    });
    fetchMock = global.fetch;
    const { container } = await renderMap({ country: 'Alpha' });
    await waitFor(() => expect(labelFor(container, 'Epsilon')).toBeTruthy());

    const subject = labelFor(container, 'Alpha').querySelector('text');
    const neighbour = labelFor(container, 'Epsilon').querySelector('text');
    expect(labelFor(container, 'Epsilon').getAttribute('data-role')).toBe('neighbour');
    // Quieter means COLOUR and weight, not smaller type...
    expect(neighbour.getAttribute('fill')).toContain('--ink-soft');
    expect(Number(neighbour.getAttribute('font-size')))
      .toBeLessThan(Number(subject.getAttribute('font-size')));
    // ...and never below the design's ten-foot floor.
    expect(Number(neighbour.getAttribute('font-size'))).toBeGreaterThanOrEqual(0.72 * 16);
  });

  it('leaves a country that is barely in the frame drawn but unnamed', async () => {
    // Zeta is a 0.2° sliver at the far edge: visible enough to draw, far too
    // small to carry its own name at rail size.
    __resetMapCache();
    global.fetch = okFetch({
      type: 'FeatureCollection',
      features: [square('Alpha', 0, -1, 2, 1), square('Zeta', 3.7, 0.9, 3.9, 1.0)],
    });
    fetchMock = global.fetch;
    const { container } = await renderMap({ country: 'Alpha' });
    await waitFor(() => expect(pathOf(container, 'Zeta')).toBeTruthy());

    expect(pathOf(container, 'Zeta')).toBeTruthy();       // drawn
    expect(labelFor(container, 'Zeta')).toBeNull();       // not named
  });

  it('never names a country that is off the frame entirely', async () => {
    const { container } = await renderMap({ country: 'Gamma' });   // 1°, far west
    await waitFor(() => expect(labelFor(container, 'Gamma')).toBeTruthy());
    // Beta is 20° x 20° starting 15° east of Gamma's frame — nowhere near it.
    expect(labelNames(container)).not.toContain('Beta');
  });

  it('scales every label in pixel space, so the type holds at any zoom', async () => {
    const { container } = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(labelFor(container, 'Beta')).toBeTruthy());
    const vb = viewBoxOf(container);
    const scale = Number(labelFor(container, 'Beta').getAttribute('transform').match(/scale\(([-\d.]+)\)/)[1]);
    expect(scale).toBeCloseTo(vb.w / RENDER_W, 2);
  });

  it('moves the subject\'s name clear of the city marker rather than moving the star', async () => {
    const { container } = await renderMap({ country: 'Beta', city: 'Betaville', lat: 20, lon: 20 });
    await waitFor(() => expect(container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy());

    const at = (el) => {
      const m = el.getAttribute('transform').match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const star = at(container.querySelector('[data-testid="country-map-marker"]'));
    const name = at(labelFor(container, 'Beta'));

    // The star is the fact: it stays on the city's own coordinate.
    expect(star.x).toBeCloseTo(20, 3);
    expect(star.y).toBeCloseTo(-20.419, 2);          // Mercator y of lat 20
    // The name moved out from under it. (SVG y grows downward: below the star.)
    expect(name.y).toBeGreaterThan(star.y);
  });

  /**
   * Fix round 1 (review finding): the subject's own clearance check was a
   * point-radius test against the city's MARKER star (34px in screen space),
   * which is not the same thing as the city's LABEL — a rendered word like
   * "VENICE" reaches well past 34px from its anchor. A naive spot could clear
   * the star by a wide margin and still land inside the label's text box.
   *
   * This fixture engineers exactly that: a MultiPolygon subject whose small
   * PART A (containing the city point) decides the FRAME, while its larger
   * PART B — far enough from the star to clear the old radius test, but not
   * far enough to clear the city's rendered label box — decides the LABEL
   * SPOT (`labelSpotFor` always picks the biggest clipped part). The result is
   * a subject spot ~1.3 view-units from the marker, comfortably outside the
   * ~0.5-unit marker-clearance radius, but still inside "VENICE"'s box.
   *
   * The box math below (`labelBox`/`overlaps`) mirrors CountryMap.jsx's own
   * private helpers of the same name — they have no test export — used here
   * only to verify the two rendered boxes actually clear each other.
   */
  it("relocates the subject's name clear of the city LABEL, not just the marker star", async () => {
    __resetMapCache();
    const SUBJECT = {
      type: 'Feature',
      properties: { name: 'Ruritania' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          // Part A: small, sits under the city point — the framing anchor.
          [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
          // Part B: bigger (so `labelSpotFor` picks it over A), centred at
          // lon 1.3 — outside the marker-clearance radius but, as hand-checked
          // against the frame this fixture produces, still inside the city
          // label's box before any relocation.
          [[[0.4, -1.8], [2.2, -1.8], [2.2, 1.8], [0.4, 1.8], [0.4, -1.8]]],
        ],
      },
    };
    global.fetch = okFetch({ type: 'FeatureCollection', features: [SUBJECT] });
    fetchMock = global.fetch;

    const { container } = await renderMap({
      country: 'Ruritania', city: 'Venice', lat: 0, lon: 0,
    });
    await waitFor(() => expect(container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy());
    await waitFor(() => expect(labelFor(container, 'Ruritania')).toBeTruthy());

    const labelBox = ({ x, y, text, sizePx, anchor = 'middle', unitsPerPx }) => {
      const w = (String(text).length * LABEL_EM_PER_CHAR + LABEL_MARGIN_EM * 2) * sizePx * unitsPerPx;
      const h = (1 + LABEL_MARGIN_EM) * sizePx * unitsPerPx;
      let x0 = x - w / 2;
      if (anchor === 'start') x0 = x;
      if (anchor === 'end') x0 = x - w;
      return { x0, x1: x0 + w, y0: y - h / 2, y1: y + h / 2 };
    };
    const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

    // The city's rendered label box: marker group gives the translate/scale,
    // the label text itself carries the local (unscaled) x/y offset.
    const markerGroup = container.querySelector('[data-testid="country-map-marker"]');
    const [, markerX, markerY] = markerGroup.getAttribute('transform').match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
    const scale = Number(markerGroup.getAttribute('transform').match(/scale\((-?[\d.]+)\)/)[1]);
    const cityLabel = container.querySelector('[data-testid="country-map-label"]');
    const cityBox = labelBox({
      x: Number(markerX) + Number(cityLabel.getAttribute('x')) * scale,
      y: Number(markerY) + Number(cityLabel.getAttribute('y')) * scale,
      text: cityLabel.textContent,
      sizePx: Number(cityLabel.getAttribute('font-size')),
      anchor: cityLabel.getAttribute('text-anchor'),
      unitsPerPx: scale,
    });

    // The subject's rendered label box: its own group is translated straight
    // to the FINAL (possibly relocated) x/y — the text inside carries no
    // further offset.
    const subjectGroup = labelFor(container, 'Ruritania');
    const [, subjX, subjY] = subjectGroup.getAttribute('transform').match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
    const subjectText = subjectGroup.querySelector('text');
    const subjectBox = labelBox({
      x: Number(subjX),
      y: Number(subjY),
      text: subjectText.textContent,
      sizePx: Number(subjectText.getAttribute('font-size')),
      anchor: subjectText.getAttribute('text-anchor'),
      unitsPerPx: scale,
    });

    expect(overlaps(cityBox, subjectBox), 'the subject\'s name still overlaps the city label').toBe(false);

    // And it was actually RELOCATED, not accidentally clear: Part B's own
    // centroid is at y=0 (its lat range -1.8..1.8 is symmetric), the same row
    // as the city. A y this far below proves the box-collision check moved it.
    expect(Number(subjY)).toBeGreaterThan(0.3);
  });

  it('names no country when the geodata has no names to give', async () => {
    __resetMapCache();
    global.fetch = okFetch({
      type: 'FeatureCollection',
      features: [{ ...square('', 0, -1, 2, 1), properties: {} }],
    });
    fetchMock = global.fetch;
    const { container } = await renderMap({ country: 'Alpha' });
    await waitFor(() => expect(svgOf(container)).toBeTruthy());
    expect(labelNames(container)).toEqual([]);
  });
});
