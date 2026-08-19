import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import * as sass from 'sass';
import ComposerCard, {
  ASSET_WARN_PER_MINUTE,
  COMPOSER_FACT_INTERVAL_MS,
  COMPOSER_FACT_FADE_MS,
  COMPOSER_FACT_HOLD_MS,
} from './ComposerCard.jsx';
import { FACT_INTERVAL_MS } from './CueTicker.jsx';
import { __resetMapCache } from '../map/CountryMap.jsx';
import { registerSurroundBuiltins, SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry, resetSurroundRegistry } from '../registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

// Vivaldi/Spring, matching the fixture WorkPlacard.test.jsx already uses for the
// piece half of this same programme — the rail card below tests the PERSON side:
// composer identity, portrait, and (new in this task) a city photo. `piece` stays
// on the fixture because the payload still carries it end to end; the card itself
// must not render any of it (the top placard owns that now).
const DATA = {
  contentId: 'plex:663146',
  assetBase: 'surround/classical',
  composer: {
    name: 'Antonio Vivaldi',
    born: 1678,
    died: 1741,
    birthplace: 'Venice, Republic of Venice',
    portrait: 'vivaldi/portrait.jpg',
    city_image: 'vivaldi/venice.jpg',
    map: { country: 'Italy', city: 'Venice', lat: 45.44, lon: 12.33 },
  },
  piece: {
    title: 'Violin Concerto in E major, "Spring"',
    opus: 'Op. 8 No. 1, RV 269',
    composed: 'by 1725',
    city: 'Venice',
    premiered: 'Published Amsterdam, 1725',
  },
};

// `composer` is a shorthand for tests that only need to swap the identity block
// (e.g. "no city authored") without hand-building the rest of the payload.
const renderCard = ({ data, composer, logger = makeLogger(), position = 0 } = {}) => {
  const payload = data ?? (composer ? { ...DATA, composer } : DATA);
  const props = (p) => ({
    position: p, duration: 3223, playing: true, seeking: false,
    data: payload, region: { module: 'composer-card', width: '20%' }, logger,
  });
  const view = render(<ComposerCard {...props(position)} />);
  return { ...view, logger, at: (p) => view.rerender(<ComposerCard {...props(p)} />) };
};

describe('ComposerCard', () => {
  it('renders the composer identity inherited from _composer.yml', () => {
    const { getByTestId, container } = renderCard();
    expect(getByTestId('surround-composer-card')).toBeInTheDocument();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Antonio Vivaldi');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1678');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1741');
    expect(container.querySelector('.surround-composer-card__birthplace'))
      .toHaveTextContent('Venice, Republic of Venice');
  });

  // The top placard (a sibling module, out of scope here) now owns every piece.*
  // field. This is the new contract for the rail card, not a hole in coverage —
  // it replaces the old "renders the piece identity beneath the brass hairline"
  // assertion, which asserted the opposite.
  it('no longer prints the piece — the placard owns it', () => {
    const { container } = renderCard();          // fixture includes piece
    expect(container.querySelector('.surround-composer-card__piece-title')).toBeNull();
    expect(container.textContent).not.toContain('Violin Concerto');
    expect(container.textContent).not.toContain('RV 269');
  });

  it('sets the name on the brass nameplate', () => {
    const { container } = renderCard();
    const plate = container.querySelector('.surround-composer-card__nameplate');
    expect(plate).toBeTruthy();
    expect(plate.textContent).toContain('Antonio Vivaldi');
  });

  it('builds the portrait URL from assetBase through the static image route', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('surround-portrait').getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/vivaldi/portrait.jpg`);
  });

  it('shows the city photo when authored, captioned with the city', () => {
    const { container } = renderCard();          // fixture: city_image + map.city 'Venice'
    const fig = container.querySelector('.surround-composer-card__city');
    expect(fig).toBeTruthy();
    expect(fig.querySelector('img').getAttribute('src')).toContain('venice');
    expect(fig.textContent).toContain('Venice');
  });

  it('builds the city image URL through the same static route as the portrait', () => {
    const { container } = renderCard();
    const img = container.querySelector('.surround-composer-card__city img');
    expect(img.getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/vivaldi/venice.jpg`);
  });

  it('renders no city figure when none is authored', () => {
    const { container } = renderCard({ composer: { name: 'X', facts: [] } });
    expect(container.querySelector('.surround-composer-card__city')).toBeNull();
  });

  // The figure's caption: a human sentence when the sidecar authors one, the
  // bare city name when it does not. The controller authors `map.caption` after
  // this lands, so BOTH paths are pinned here rather than only the live one.
  it('prints the authored caption under the city figure', () => {
    const composer = {
      ...DATA.composer,
      map: { ...DATA.composer.map, caption: 'Venice — his lifelong home' },
    };
    const { getByTestId } = renderCard({ composer });
    const caption = getByTestId('surround-city-caption');
    expect(caption.textContent).toBe('Venice — his lifelong home');
    // Set as prose, not as a tracked-uppercase label.
    expect(caption.className).toContain('surround-composer-card__city-caption--sentence');
  });

  it('falls back to the city name, set as a label, when no caption is authored', () => {
    const { getByTestId } = renderCard();          // fixture has map.city, no caption
    const caption = getByTestId('surround-city-caption');
    expect(caption.textContent).toBe('Venice');
    expect(caption.className).toContain('surround-composer-card__city-caption--label');
  });

  it('treats a blank caption as unauthored rather than printing an empty line', () => {
    const composer = { ...DATA.composer, map: { ...DATA.composer.map, caption: '   ' } };
    const { getByTestId } = renderCard({ composer });
    expect(getByTestId('surround-city-caption').textContent).toBe('Venice');
  });

  it('prints the caption even when the map block names no city', () => {
    const composer = { ...DATA.composer, map: { country: 'Italy', caption: 'The lagoon he never left' } };
    const { getByTestId } = renderCard({ composer });
    expect(getByTestId('surround-city-caption').textContent).toBe('The lagoon he never left');
  });

  it('captions nothing when neither a caption nor a city is authored', () => {
    const composer = { ...DATA.composer, map: { country: 'Italy' } };
    const { container, queryByTestId } = renderCard({ composer });
    expect(container.querySelector('.surround-composer-card__city')).not.toBeNull();
    expect(queryByTestId('surround-city-caption')).toBeNull();
  });

  it('hides a broken portrait without breaking the layout, and warns', () => {
    const { getByTestId, container, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    fireEvent.error(img);

    expect(img.style.display).toBe('none');
    // The rest of the card is untouched.
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Antonio Vivaldi');
    expect(container.querySelector('.surround-composer-card__city')).not.toBeNull();

    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.asset.missing');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663146', ref: 'vivaldi/portrait.jpg' });
    expect(warned[1].src).toContain('surround/classical/vivaldi/portrait.jpg');
  });

  it('caps asset-missing warnings so a broken path cannot flood the log store', () => {
    const { getByTestId, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    for (let i = 0; i < ASSET_WARN_PER_MINUTE + 4; i += 1) fireEvent.error(img);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.asset.missing'))
      .toHaveLength(ASSET_WARN_PER_MINUTE);
  });

  // Piece fields (opus/composed/premiered/title) left this card for the top
  // placard in this task — there is no longer a resilience case to cover here;
  // see "no longer prints the piece" above for the card's actual contract.

  it('still composes the card when there is no portrait', () => {
    const data = { ...DATA, composer: { ...DATA.composer, portrait: undefined } };
    const { container, queryByTestId } = renderCard({ data });
    expect(queryByTestId('surround-portrait')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Antonio Vivaldi');
    // The rest of the identity — nameplate and city photo — is untouched.
    expect(container.querySelector('.surround-composer-card__nameplate')).not.toBeNull();
    expect(container.querySelector('.surround-composer-card__city')).not.toBeNull();
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
    expect(container.querySelector('.surround-composer-card__dates').textContent).toContain('1678');
    expect(container.querySelector('.surround-composer-card__dates').textContent).not.toContain('1741');
  });

  it('omits the dates line entirely when neither year is known', () => {
    const data = { ...DATA, composer: { name: 'Anon.' } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__dates')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Anon.');
  });

  // The card is wholly the person now, so with no composer block there is
  // nothing to identify — the old assertion here (the piece rendering "alone")
  // no longer applies, since the piece never renders in this card at all.
  it('renders an empty identity, without throwing, when no composer block was authored', () => {
    const data = { ...DATA, composer: undefined };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__name')).toBeNull();
    expect(container.querySelector('.surround-composer-card__nameplate')).toBeNull();
    expect(container.querySelector('.surround-composer-card__city')).toBeNull();
    expect(container.querySelector('.surround-composer-card__piece-title')).toBeNull();
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
 * Fix round 1 (review finding): the hard content budget capped the portrait, the
 * city photo, and the bio fact — but not the nameplate text itself. A long name
 * or birthplace could still grow the card past the viewport, one element over
 * from the original 742-on-720 defect.
 *
 * This harness's vitest config runs `css: false` (the project default — see
 * vitest.config.mjs), so `import './ComposerCard.scss'` inside the component
 * injects no stylesheet into the test DOM at all; asserting computed style off
 * a plain render would read UA defaults, not the shipped rule, and would pass
 * whether or not the SCSS actually clamps anything (a vacuously-true test).
 * Instead this compiles the REAL ComposerCard.scss with the project's own sass
 * compiler and injects the result before asserting — so a regression in the
 * actual file (not a hand-typed stand-in string) fails this test.
 */
describe('ComposerCard hard content budget — long text', () => {
  let injectedStyle = null;

  afterEach(() => {
    injectedStyle?.remove();
    injectedStyle = null;
  });

  it('caps the name to 2 lines and ellipsizes the birthplace and city caption to 1', () => {
    const compiled = sass.compile(path.join(__dirname, 'ComposerCard.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);

    const data = {
      ...DATA,
      composer: {
        ...DATA.composer,
        name: 'Johann Nepomuk Eduard Ambrosius Nepomucenus von und zu Überlingen-Hohenzollern',
        birthplace: 'Sankt Georgen an der Gusen, Oberösterreich, Holy Roman Empire',
        map: { ...DATA.composer.map, city: 'A Preposterously Long City Name Nobody Would Actually Author' },
      },
    };
    const { container } = renderCard({ data });

    const name = container.querySelector('.surround-composer-card__name');
    const nameStyle = window.getComputedStyle(name);
    expect(nameStyle.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(nameStyle.getPropertyValue('-webkit-box-orient')).toBe('vertical');
    expect(nameStyle.getPropertyValue('overflow')).toBe('hidden');

    const birthplace = container.querySelector('.surround-composer-card__birthplace');
    const birthplaceStyle = window.getComputedStyle(birthplace);
    expect(birthplaceStyle.getPropertyValue('white-space')).toBe('nowrap');
    expect(birthplaceStyle.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(birthplaceStyle.getPropertyValue('overflow')).toBe('hidden');

    const caption = container.querySelector('.surround-composer-card__city figcaption');
    const captionStyle = window.getComputedStyle(caption);
    expect(captionStyle.getPropertyValue('white-space')).toBe('nowrap');
    expect(captionStyle.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(captionStyle.getPropertyValue('overflow')).toBe('hidden');
  });

  // Dates are numeric and short ("1678 – 1741") with a bounded vocabulary — they
  // cannot grow the way a name or place name can, so the class deliberately
  // carries no clamp. This pins that as a decision, not an oversight: if dates
  // ever gain the ability to be long (a free-text era string, say), they need
  // the same treatment as birthplace.
  it('leaves the dates line uncapped — it is numeric and inherently short', () => {
    const { container } = renderCard();
    const dates = container.querySelector('.surround-composer-card__dates');
    expect(dates.textContent.length).toBeLessThan(20);
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
  /** The dissolve commits after the fade-out AND the held beat of empty ground. */
  const SWAP_MS = COMPOSER_FACT_FADE_MS + COMPOSER_FACT_HOLD_MS;

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

  // Updated: the piece title (h3) no longer lives in this card at all, so the
  // ordering check below only has the name (h2) and the fact (p) left to assert
  // — the old ['h2', 'h3', 'p'] expectation asserted an element that is gone.
  it('shows the first composer fact as quiet supporting text at the foot of the rail', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    expect(view.text()).toBe(FACTS[0]);
    // Quiet: the composer name stays the loud thing in the rail.
    const card = view.getByTestId('surround-composer-card');
    const order = [...card.querySelectorAll('h2, h3, [data-testid="surround-composer-fact"]')]
      .map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(['h2', 'p']);
  });

  it('cycles the facts on its own timer, wrapping back to the first', () => {
    const view = renderFacts({ data: withFacts(FACTS) });

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(SWAP_MS);
    expect(view.text()).toBe(FACTS[1]);

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(SWAP_MS);
    expect(view.text()).toBe(FACTS[2]);

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(SWAP_MS);
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
    tick(SWAP_MS);
    expect(view.text()).toBe(FACTS[0]);
  });

  it('fades out, swaps, then fades in — it never hard-cuts', () => {
    const view = renderFacts({ data: withFacts(FACTS) });

    tick(COMPOSER_FACT_INTERVAL_MS);
    // Mid-choreography: the OLD line is still mounted, faded out.
    expect(view.text()).toBe(FACTS[0]);
    expect(view.fact().className).toContain('surround-composer-card__fact--hidden');

    tick(SWAP_MS);
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
    tick(SWAP_MS);
    expect(view.text()).toBe(FACTS[0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders nothing at all for the fact region when the composer has no facts', () => {
    for (const facts of [undefined, [], ['', '   ']]) {
      const view = renderFacts({ data: withFacts(facts) });
      expect(view.fact()).toBeNull();
      expect(view.container.querySelector('.surround-composer-card__fact')).toBeNull();
      expect(view.container.querySelector('.surround-composer-card__fact-rule')).toBeNull();
      // ...and the card is still composed around it. The piece-title check that
      // used to sit here is gone for good — this card never renders piece.* now.
      expect(view.container.querySelector('.surround-composer-card__name'))
        .toHaveTextContent('Antonio Vivaldi');
      expect(view.container.querySelector('.surround-composer-card__piece-title')).toBeNull();
      view.unmount();
    }
  });

  it('is time-driven, not playhead-driven — position changes never advance it', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    for (const p of [12, 400, 976, 1925, 2278, 3000]) view.at(p);
    expect(view.text()).toBe(FACTS[0]);

    // The same component, with the clock frozen, does advance on its own timer.
    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(SWAP_MS);
    expect(view.text()).toBe(FACTS[1]);
  });

  it('logs each fact it shows', () => {
    const view = renderFacts({ data: withFacts(FACTS) });
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.composer-fact.shown');

    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toEqual({ contentId: 'plex:663146', index: 0 });

    tick(COMPOSER_FACT_INTERVAL_MS);
    tick(SWAP_MS);
    expect(shown()).toHaveLength(2);
    expect(shown()[1][1]).toEqual({ contentId: 'plex:663146', index: 1 });
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

/**
 * Design wave 2: the rail's pictures are never cropped, and the fact slot never
 * moves. Same compiled-SCSS injection as the content-budget suite above — the
 * assertions are about the shipped stylesheet, not about a stand-in string.
 */
describe('ComposerCard — pictures whole, fact slot still', () => {
  let injectedStyle = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'ComposerCard.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);
    return compiled.css;
  };
  afterEach(() => { injectedStyle?.remove(); injectedStyle = null; });

  it('shrinks the portrait inside its mat instead of cropping it', () => {
    withStyles();
    const { getByTestId } = renderCard();
    const style = window.getComputedStyle(getByTestId('surround-portrait'));
    expect(style.getPropertyValue('object-fit')).toBe('contain');
    expect(style.getPropertyValue('object-fit')).not.toBe('cover');
    expect(style.getPropertyValue('height')).toBe('auto');
    expect(style.getPropertyValue('object-position')).toBe('center');
  });

  it('shrinks the city photo the same way', () => {
    withStyles();
    const { getByTestId } = renderCard();
    const style = window.getComputedStyle(getByTestId('surround-city-image'));
    expect(style.getPropertyValue('object-fit')).toBe('contain');
    expect(style.getPropertyValue('height')).toBe('auto');
  });

  it("bans cover from the rail's pictures outright", () => {
    // Comments survive compilation and one of them NAMES the banned value, so
    // strip them before the search — otherwise this fails on its own rationale.
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/object-fit:\s*cover/);
  });

  it('reserves three lines for the fact so rotation never walks the rail', () => {
    withStyles();
    const short = renderCard({ composer: { ...DATA.composer, facts: ['Short.'] } });
    const long = renderCard({
      composer: {
        ...DATA.composer,
        facts: ['A much longer fact about the composer that will certainly run to three full lines at the rail measure, and then some.'],
      },
    });
    // `container.querySelector`, not `getByTestId`: both cards are mounted in the
    // same document here, and a body-scoped query would find two.
    const reserve = (view) => window.getComputedStyle(
      view.container.querySelector('[data-testid="surround-composer-fact"]'),
    ).getPropertyValue('min-height');

    expect(parseFloat(reserve(short))).toBeGreaterThan(0);
    expect(reserve(short)).toBe(reserve(long));
  });

  it('sets the fact centred and balanced', () => {
    withStyles();
    const { getByTestId } = renderCard({ composer: { ...DATA.composer, facts: ['A fact.'] } });
    const style = window.getComputedStyle(getByTestId('surround-composer-fact'));
    expect(style.getPropertyValue('text-align')).toBe('center');
    expect(style.getPropertyValue('text-wrap')).toBe('balance');
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('3');
  });

  it('keeps real paper under both pictures, so the mats survive the dark rail', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    // Both the portrait plate and the city figure read the un-remapped
    // `--programme` token — that is what makes them read as mats rather than as
    // two more dark rectangles.
    expect(css).toMatch(/\.surround-composer-card__plate \{[^}]*var\(--programme,/);
    expect(css).toMatch(/\.surround-composer-card__city \{[^}]*var\(--programme,/);
  });
});
