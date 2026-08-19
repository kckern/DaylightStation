import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import ComposerCard, {
  ASSET_WARN_PER_MINUTE,
  COMPOSER_FACT_INTERVAL_MS,
  COMPOSER_FACT_FADE_MS,
} from './ComposerCard.jsx';
import { FACT_INTERVAL_MS } from './CueTicker.jsx';
import { __resetMapCache } from '../map/CountryMap.jsx';
import { registerSurroundBuiltins, SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry, resetSurroundRegistry } from '../registry.js';

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const DATA = {
  contentId: 'plex:663134',
  assetBase: 'surround/classical',
  composer: {
    name: 'Ludwig van Beethoven',
    born: 1770,
    died: 1827,
    birthplace: 'Bonn (Electorate of Cologne)',
    portrait: 'beethoven/portrait.jpg',
  },
  piece: {
    title: 'Symphony No. 3 in E-flat major, "Eroica"',
    opus: 'Op. 55',
    composed: '1803-1804',
    city: 'Vienna',
    premiered: '1805, Theater an der Wien',
  },
};

const renderCard = ({ data = DATA, logger = makeLogger(), position = 0 } = {}) => {
  const props = (p) => ({
    position: p, duration: 3223, playing: true, seeking: false,
    data, region: { module: 'composer-card', width: '20%' }, logger,
  });
  const view = render(<ComposerCard {...props(position)} />);
  return { ...view, logger, at: (p) => view.rerender(<ComposerCard {...props(p)} />) };
};

const datum = (container, label) => {
  const dt = [...container.querySelectorAll('.surround-composer-card__label')]
    .find((el) => el.textContent.toLowerCase() === label.toLowerCase());
  return dt ? dt.parentElement.querySelector('.surround-composer-card__value')?.textContent : null;
};

describe('ComposerCard', () => {
  it('renders the composer identity inherited from _composer.yml', () => {
    const { getByTestId, container } = renderCard();
    expect(getByTestId('surround-composer-card')).toBeInTheDocument();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1770');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1827');
    expect(container.querySelector('.surround-composer-card__birthplace'))
      .toHaveTextContent('Bonn (Electorate of Cologne)');
  });

  it('renders the piece identity beneath the brass hairline', () => {
    const { container } = renderCard();
    expect(container.querySelector('.surround-composer-card__piece-title'))
      .toHaveTextContent('Symphony No. 3 in E-flat major, "Eroica"');
    expect(datum(container, 'Opus')).toBe('Op. 55');
    expect(datum(container, 'Composed')).toBe('1803-1804');
    expect(datum(container, 'City')).toBe('Vienna');
    expect(datum(container, 'Premiered')).toBe('1805, Theater an der Wien');
  });

  it('builds the portrait URL from assetBase through the static image route', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('surround-portrait').getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/beethoven/portrait.jpg`);
  });

  it('hides a broken portrait without breaking the layout, and warns', () => {
    const { getByTestId, container, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    fireEvent.error(img);

    expect(img.style.display).toBe('none');
    // The rest of the card is untouched.
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__piece-title')).not.toBeNull();

    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.asset.missing');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663134', ref: 'beethoven/portrait.jpg' });
    expect(warned[1].src).toContain('surround/classical/beethoven/portrait.jpg');
  });

  it('caps asset-missing warnings so a broken path cannot flood the log store', () => {
    const { getByTestId, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    for (let i = 0; i < ASSET_WARN_PER_MINUTE + 4; i += 1) fireEvent.error(img);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.asset.missing'))
      .toHaveLength(ASSET_WARN_PER_MINUTE);
  });

  it('still composes the card when the piece has no opus and no premiere', () => {
    const data = { ...DATA, piece: { title: 'Spring', composed: '1725' } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__piece-title')).toHaveTextContent('Spring');
    expect(datum(container, 'Composed')).toBe('1725');
    expect(datum(container, 'Opus')).toBeNull();
    expect(datum(container, 'Premiered')).toBeNull();
    expect(datum(container, 'City')).toBeNull();
  });

  it('still composes the card when there is no portrait', () => {
    const data = { ...DATA, composer: { ...DATA.composer, portrait: undefined } };
    const { container, queryByTestId } = renderCard({ data });
    expect(queryByTestId('surround-portrait')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__piece-title')).not.toBeNull();
  });

  it('omits the portrait when the payload names no assetBase', () => {
    const data = { ...DATA, assetBase: undefined };
    const { queryByTestId, container } = renderCard({ data });
    expect(queryByTestId('surround-portrait')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).not.toBeNull();
  });

  it('reads a life span with only a birth year as an open one', () => {
    const data = { ...DATA, composer: { ...DATA.composer, died: undefined } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__dates').textContent).toContain('1770');
    expect(container.querySelector('.surround-composer-card__dates').textContent).not.toContain('1827');
  });

  it('omits the dates line entirely when neither year is known', () => {
    const data = { ...DATA, composer: { name: 'Anon.' } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__dates')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Anon.');
  });

  it('renders the piece alone when no composer block was authored', () => {
    const data = { ...DATA, composer: undefined };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__name')).toBeNull();
    expect(container.querySelector('.surround-composer-card__piece-title')).toHaveTextContent('Symphony No. 3');
  });

  it('renders an empty card, without throwing, when the payload is missing', () => {
    let view;
    expect(() => { view = renderCard({ data: null }); }).not.toThrow();
    expect(view.getByTestId('surround-composer-card')).toBeInTheDocument();
  });

  it('is position-independent — the clock never changes what it renders', () => {
    const view = renderCard({ position: 0 });
    const before = view.container.innerHTML;
    view.at(2999);
    expect(view.container.innerHTML).toBe(before);
  });
});

/**
 * Composer-level facts — inherited from `_composer.yml`, so they are about the
 * person, not the piece, and are independent of the playhead. The rail cycles
 * them on its OWN timer; the footer ticker cycles piece facts on its own. Two
 * panels swapping text in the same instant reads as a glitch, which is why the
 * two intervals must not beat together.
 */
describe('ComposerCard composer facts', () => {
  const FACTS = [
    'Bach had twenty children. Four of them grew up to be composers too.',
    'As a young man he walked about 280 miles each way to hear Buxtehude play.',
    'He was jailed for a month for pestering his employer to let him leave.',
  ];

  const withFacts = (facts) => ({
    ...DATA,
    composer: { ...DATA.composer, facts },
  });

  /** One act() per step — batching several into one collapses the renders. */
  const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  const renderFacts = ({ data, logger = makeLogger(), position = 0 } = {}) => {
    const props = (p) => ({
      position: p, duration: 3223, playing: true, seeking: false,
      data, region: { module: 'composer-card', width: '20%' }, logger,
    });
    let view;
    act(() => { view = render(<ComposerCard {...props(position)} />); });
    return {
      ...view,
      logger,
      at: (p) => act(() => { view.rerender(<ComposerCard {...props(p)} />); }),
      fact: () => view.container.querySelector('[data-testid="surround-composer-fact"]'),
      text: () => view.container.querySelector('[data-testid="surround-composer-fact"]')?.textContent ?? null,
    };
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the first composer fact as quiet supporting text under the piece data', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    expect(view.text()).toBe(FACTS[0]);
    // Quiet: the composer name and the piece title stay the loud things in the rail.
    const card = view.getByTestId('surround-composer-card');
    const order = [...card.querySelectorAll('h2, h3, [data-testid="surround-composer-fact"]')]
      .map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(['h2', 'h3', 'p']);
  });

  it('cycles the facts on its own timer, wrapping back to the first', () => {
    const view = renderFacts({ data: withFacts(FACTS) });

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[1]);

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[2]);

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[0]);
  });

  it('runs on a different beat from the footer ticker', () => {
    expect(COMPOSER_FACT_INTERVAL_MS).not.toBe(FACT_INTERVAL_MS);
    // Not a harmonic of it either: sharing a beat every other swap looks the same
    // as sharing every swap.
    expect(COMPOSER_FACT_INTERVAL_MS % FACT_INTERVAL_MS).not.toBe(0);
    expect(FACT_INTERVAL_MS % COMPOSER_FACT_INTERVAL_MS).not.toBe(0);

    // And behaviourally: the card is still on fact one when the ticker swaps.
    const view = renderFacts({ data: withFacts(FACTS) });
    tick(FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[0]);
  });

  it('fades out, swaps, then fades in — it never hard-cuts', () => {
    const view = renderFacts({ data: withFacts(FACTS) });

    tick(COMPOSER_FACT_INTERVAL_MS);
    // Mid-choreography: the OLD line is still mounted, faded out.
    expect(view.text()).toBe(FACTS[0]);
    expect(view.fact().className).toContain('surround-composer-card__fact--hidden');

    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[1]);
    expect(view.fact().className).not.toContain('surround-composer-card__fact--hidden');
  });

  it('swaps instantly under prefers-reduced-motion, leaving no fade timer pending', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    try {
      const view = renderFacts({ data: withFacts(FACTS) });
      tick(COMPOSER_FACT_INTERVAL_MS);
      expect(view.text()).toBe(FACTS[1]);              // no 280ms wait
      expect(view.fact().className).not.toContain('surround-composer-card__fact--hidden');
      // Only the rotation interval is left armed — no fade timeout was scheduled.
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      window.matchMedia = original;
    }
  });

  it('does not rotate when the composer has only one fact', () => {
    const view = renderFacts({ data: withFacts([FACTS[0]]) });
    expect(view.text()).toBe(FACTS[0]);
    tick(COMPOSER_FACT_INTERVAL_MS * 5);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders nothing at all for the fact region when the composer has no facts', () => {
    for (const facts of [undefined, [], ['', '   ']]) {
      const view = renderFacts({ data: withFacts(facts) });
      expect(view.fact()).toBeNull();
      expect(view.container.querySelector('.surround-composer-card__fact')).toBeNull();
      expect(view.container.querySelector('.surround-composer-card__fact-rule')).toBeNull();
      // ...and the card is still composed around it.
      expect(view.container.querySelector('.surround-composer-card__name'))
        .toHaveTextContent('Ludwig van Beethoven');
      expect(view.container.querySelector('.surround-composer-card__piece-title')).not.toBeNull();
      view.unmount();
    }
  });

  it('is time-driven, not playhead-driven — position changes never advance it', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    for (const p of [12, 400, 976, 1925, 2278, 3000]) view.at(p);
    expect(view.text()).toBe(FACTS[0]);

    // The same component, with the clock frozen, does advance on its own timer.
    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(view.text()).toBe(FACTS[1]);
  });

  it('logs each fact it shows', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.composer-fact.shown');

    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toEqual({ contentId: 'plex:663134', index: 0 });

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(COMPOSER_FACT_FADE_MS);
    expect(shown()).toHaveLength(2);
    expect(shown()[1][1]).toEqual({ contentId: 'plex:663134', index: 1 });
  });

  it('logs nothing when there is no fact to show', () => {
    const view = renderFacts({ data: withFacts([]) });
    expect(view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.composer-fact.shown'))
      .toHaveLength(0);
  });
});

/**
 * The country map reaches the rail as a registered surround module, so the
 * generic `CountryMap` never learns the surround payload shape — a thin adapter
 * in `builtins.js` maps `data.composer.map` onto its props. These specs live
 * beside the card because that adapter is the rail's other identity module and
 * has no test file of its own.
 */
describe('country-map surround module', () => {
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
    features: [square('Beta', 10, 10, 30, 30), square('Gamma', -5, 40, -4, 41)],
  };

  let fetchMock;

  beforeEach(() => {
    __resetMapCache();
    resetSurroundRegistry();
    registerSurroundBuiltins();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GEO) }));
    global.fetch = fetchMock;
  });
  afterEach(() => { resetSurroundRegistry(); __resetMapCache(); });

  /**
   * `CountryMap` fires its fetch from inside a promise chain, so asserting
   * "asked for no geodata" straight after render would pass even if the map HAD
   * been mounted. Drain the microtask queue first, or the assertion is vacuous.
   */
  const settle = async () => {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  const MAP = { country: 'Beta', city: 'Betaville', lat: 20, lon: 20 };
  const withMap = (map) => ({ ...DATA, composer: { ...DATA.composer, map } });

  /** Render whatever the registry hands back, through the fixed module contract. */
  const renderModule = (data, logger = makeLogger()) => {
    const Module = getSurroundRegistry().get('country-map');
    expect(Module).toBeTruthy();
    const view = render(
      <Module
        position={976}
        duration={3223}
        playing
        seeking={false}
        data={data}
        region={{ module: 'country-map', height: 200 }}
        logger={logger}
      />,
    );
    return { ...view, logger };
  };

  it('is registered under the name the sidecar authors', () => {
    expect(getSurroundRegistry().has('country-map')).toBe(true);
    expect(SURROUND_BUILTIN_MODULES).toContain('country-map');
    // ...alongside, not instead of, the modules already there.
    for (const name of ['movement-map', 'cue-ticker', 'composer-card']) {
      expect(getSurroundRegistry().has(name)).toBe(true);
    }
  });

  it('passes the composer map block through to the generic map', async () => {
    const { container } = renderModule(withMap(MAP));
    await waitFor(() => expect(container.querySelector('[data-country="Beta"]')).toBeTruthy());

    expect(container.querySelector('[data-country="Beta"]').getAttribute('data-role')).toBe('highlight');
    expect(container.querySelector('[data-country="Gamma"]').getAttribute('data-role')).toBe('context');
    expect(container.querySelector('[data-testid="country-map-label"]').textContent).toBe('Betaville');
    expect(container.querySelector('[data-testid="country-map-marker"]')).toBeTruthy();
  });

  it('renders nothing, and asks for no geodata, when the composer has no map block', async () => {
    for (const data of [withMap(undefined), { ...DATA, composer: undefined }, null]) {
      let view;
      expect(() => { view = renderModule(data); }).not.toThrow();
      expect(view.container.innerHTML).toBe('');
      await settle();
      expect(view.container.innerHTML).toBe('');
      view.unmount();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders nothing when the map block names no country', async () => {
    const view = renderModule(withMap({ city: 'Betaville', lat: 20, lon: 20 }));
    await settle();
    expect(view.container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still draws the country when the map block carries no city pin', async () => {
    const { container } = renderModule(withMap({ country: 'Beta' }));
    await waitFor(() => expect(container.querySelector('[data-country="Beta"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="country-map-marker"]')).toBeNull();
  });
});
