import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import CountryMap, { __resetMapCache, RENDER_W, RENDER_H } from './CountryMap.jsx';

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
  it('fills the highlighted country and mutes every other one', async () => {
    const { container } = await renderMap({ country: 'Beta' });
    await waitFor(() => expect(pathOf(container, 'Beta')).toBeTruthy());

    const beta = pathOf(container, 'Beta');
    expect(beta.getAttribute('data-role')).toBe('highlight');
    expect(beta.getAttribute('fill')).toContain('--velvet');

    for (const other of ['Alpha', 'Gamma']) {
      const el = pathOf(container, other);
      expect(el.getAttribute('data-role')).toBe('context');
      expect(el.getAttribute('fill')).toContain('--programme-edge');
      expect(el.getAttribute('stroke')).toContain('--programme');
    }
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

  it('auto-frames: the highlighted country fills a large share of its frame', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      __resetMapCache();
      global.fetch = okFetch();
      fetchMock = global.fetch;
      const { container } = await renderMap({ country: name });
      await waitFor(() => expect(pathOf(container, name)).toBeTruthy());
      const vb = viewBoxOf(container);
      const ext = extentOf(pathOf(container, name));
      const share = Math.max(ext.w / vb.w, ext.h / vb.h);
      expect(share).toBeGreaterThan(0.7);
      expect(share).toBeLessThanOrEqual(1);
    }
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

    __resetMapCache();
    global.fetch = okFetch();
    fetchMock = global.fetch;
    const rightEdge = await renderMap({ country: 'Beta', city: 'Eastward', lat: 20, lon: 29.5 });
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
