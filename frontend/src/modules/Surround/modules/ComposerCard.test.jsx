import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import * as sass from 'sass-embedded';
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

// COMPILE EACH SHEET ONCE PER FILE. A stylesheet cannot change mid-run, but
// `withStyles()` recompiled it on every call — up to 20 times in this file
// alone, across nine specs that each do the same. `sass.compile` is
// synchronous and CPU-heavy, and under a full parallel sweep (~1,000 files on
// every core) that redundant work is what starves a worker past its timeout,
// failing whichever timing-shaped test it was inside. Memoised by path.
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};


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

  // Museum convention (settled by the user 2026-08-19): the brass reads name
  // AND dates, engraved together. Birthplace is not on the metal.
  it('sets the name and the dates on the brass nameplate', () => {
    const { container } = renderCard();
    const plate = container.querySelector('.surround-composer-card__nameplate');
    expect(plate).toBeTruthy();
    expect(plate.textContent).toContain('Antonio Vivaldi');
    expect(plate.textContent).toContain('1678');
    expect(plate.textContent).toContain('1741');
    expect(plate.querySelector('.surround-composer-card__dates')).not.toBeNull();
    expect(plate.textContent).not.toContain('Venice');
  });

  it('builds the portrait URL from assetBase through the static image route', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('surround-portrait').getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/vivaldi/portrait.jpg`);
  });

  // WAVE 3 CONTRACT. The city figure LEFT this card — place imagery belongs to
  // `place-carousel` in the rail region below. Asserted as an absence the same
  // way the piece block's departure was, so a re-introduction fails here rather
  // than silently giving the rail two competing pictures. The fixture still
  // carries `city_image` and `map.caption`: the card must ignore both.
  it('no longer prints the city figure — the place carousel owns it', () => {
    const composer = {
      ...DATA.composer,
      map: { ...DATA.composer.map, caption: 'Venice — his lifelong home' },
    };
    const { container, queryByTestId } = renderCard({ composer });
    expect(container.querySelector('.surround-composer-card__city')).toBeNull();
    expect(queryByTestId('surround-city-image')).toBeNull();
    expect(queryByTestId('surround-city-caption')).toBeNull();
    expect(container.textContent).not.toContain('his lifelong home');
    // The portrait — the card's own picture — is untouched by that departure.
    expect(queryByTestId('surround-portrait')).not.toBeNull();
  });

  it('asks for no city asset at all, even when one is authored', () => {
    const { container } = renderCard();          // fixture: city_image vivaldi/venice.jpg
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src'));
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toContain('portrait.jpg');
    expect(srcs.some((s) => s.includes('venice'))).toBe(false);
  });

  // The header row: portrait LEFT, the identity column RIGHT, side by side. The
  // DOM order is the reading order, and the geometry that makes them adjacent
  // rather than stacked is the runtime gate's job (jsdom has no layout).
  // Fix round 1: the mat now sits inside its own 45% COLUMN rather than
  // carrying the 45% itself, so the header row's direct children are the
  // column and the identity block — the mat is one level deeper.
  it('puts the portrait and the identity column side by side in one header row', () => {
    const { getByTestId, container } = renderCard();
    const header = getByTestId('surround-composer-header');
    const portraitCol = getByTestId('surround-portrait-col');
    const plate = container.querySelector('.surround-composer-card__plate');
    const identity = getByTestId('surround-composer-identity');

    expect(portraitCol.parentElement).toBe(header);
    expect(plate.parentElement).toBe(portraitCol);
    expect(identity.parentElement).toBe(header);
    // Portrait first: the picture is on the left.
    expect([...header.children].indexOf(portraitCol)).toBeLessThan([...header.children].indexOf(identity));
  });

  // Updated 2026-08-19: museum convention settled the open design question —
  // the brass reads name AND dates, engraved together, so the identity column
  // now stacks just the nameplate (name+dates) and the birthplace, not three
  // siblings. The old assertion here put dates on the rail ground as a sibling
  // of the plate; that contract is superseded by this one.
  it('stacks the nameplate (name + dates) and the birthplace in the identity column', () => {
    const { getByTestId } = renderCard();
    const identity = getByTestId('surround-composer-identity');
    const classes = [...identity.children].map((el) => el.className);
    expect(classes).toEqual([
      'surround-composer-card__nameplate',
      'surround-composer-card__birthplace',
    ]);

    const nameplate = identity.querySelector('.surround-composer-card__nameplate');
    expect([...nameplate.children].map((el) => el.className)).toEqual([
      'surround-composer-card__name',
      'surround-composer-card__dates',
    ]);
    expect(nameplate.querySelector('.surround-composer-card__name').textContent).toBe('Antonio Vivaldi');
    expect(nameplate.querySelector('.surround-composer-card__dates').textContent).toBe('1678 – 1741');

    // Birthplace stays OUTSIDE the plate, in parchment, exactly where it was.
    const birthplace = identity.querySelector('.surround-composer-card__birthplace');
    expect(birthplace.closest('.surround-composer-card__nameplate')).toBeNull();
  });

  it('hides a broken portrait without breaking the layout, and warns', () => {
    const { getByTestId, container, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    fireEvent.error(img);

    expect(img.style.display).toBe('none');
    // The rest of the card is untouched.
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Antonio Vivaldi');
    expect(container.querySelector('.surround-composer-card__nameplate')).not.toBeNull();

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
    // The header row survives with one column: the identity takes the width the
    // missing picture would have had rather than sitting beside an empty box.
    expect(container.querySelector('.surround-composer-card__nameplate')).not.toBeNull();
    expect(queryByTestId('surround-composer-header')).not.toBeNull();
    expect(container.querySelector('.surround-composer-card__plate')).toBeNull();
    expect(queryByTestId('surround-portrait-col')).toBeNull();
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

  it('caps the name to 3 lines and ellipsizes the birthplace to 1', () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
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

    // Wave 4: the ceiling is a real `max-height` (3 lines at line-height 1.15),
    // NOT `-webkit-line-clamp`. The clamp idiom computes to `flow-root` in
    // current Chromium and cannot be relied on for a BOX — the same finding
    // that put min+max heights on the fact and the ticker. `overflow: hidden`
    // is what makes the height a real cut rather than a suggestion.
    // (happy-dom resolves `em` off the default 16px root rather than off the
    // element's own cascaded font-size, so 3.45em reads back as 55.2px here.
    // Documented so a future reader does not mistake it for a picked pixel.)
    const name = container.querySelector('.surround-composer-card__name');
    const nameStyle = window.getComputedStyle(name);
    expect(parseFloat(nameStyle.getPropertyValue('max-height'))).toBeCloseTo(3.45 * 16, 1);
    expect(nameStyle.getPropertyValue('overflow')).toBe('hidden');
    // ...and it is NOT a -webkit-box any more, which is what lets the name wrap
    // at word boundaries under `text-wrap: balance` (below).
    expect(nameStyle.getPropertyValue('display')).toBe('block');

    const birthplace = container.querySelector('.surround-composer-card__birthplace');
    const birthplaceStyle = window.getComputedStyle(birthplace);
    expect(birthplaceStyle.getPropertyValue('white-space')).toBe('nowrap');
    expect(birthplaceStyle.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(birthplaceStyle.getPropertyValue('overflow')).toBe('hidden');
  });

  // The header row's split. 45% is the sketch's proportion, and it lives on a
  // real WRAPPER element (`__portrait-col`) so the MAT inside it can still hug
  // the picture — a contained picture in a 45%-wide MAT would be a pool of
  // paper, which wave 2 removed. Fix round 1: this used to assert both
  // properties on the mat itself, which is exactly the defect (flex-basis wins
  // over `width: fit-content` on the same element, so the mat was 45% wide
  // regardless of the picture's shape).
  it('gives the portrait column 45% of the card, and lets the mat hug its picture', () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);

    const { getByTestId } = renderCard();

    // The COLUMN carries the 45% flex basis...
    const portraitCol = window.getComputedStyle(getByTestId('surround-portrait-col'));
    expect(portraitCol.getPropertyValue('max-width')).toBe('45%');
    expect(portraitCol.getPropertyValue('flex-basis')).toBe('45%');

    // ...and the MAT inside it carries no width share of its own — it hugs
    // its picture instead, so a tall (2:3) portrait gets a snug mat rather
    // than a 45%-wide slab with the picture floating inside it.
    const plate = window.getComputedStyle(getByTestId('surround-portrait-plate'));
    expect(plate.getPropertyValue('width')).toBe('fit-content');
    expect(plate.getPropertyValue('flex-basis')).not.toBe('45%');
    expect(plate.getPropertyValue('max-width')).not.toBe('45%');

    const header = window.getComputedStyle(getByTestId('surround-composer-header'));
    expect(header.getPropertyValue('display')).toBe('flex');
    expect(header.getPropertyValue('flex-direction')).toBe('row');
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

  // Museum convention (settled 2026-08-19): the plate hugs its widest line —
  // the name — so the short dates line underneath can never be what widens it.
  it('hugs the name — the plate is width: fit-content, so short dates cannot widen it', () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);

    const { container } = renderCard();
    const plate = window.getComputedStyle(container.querySelector('.surround-composer-card__nameplate'));
    expect(plate.getPropertyValue('width')).toBe('fit-content');
  });

  /**
   * Design wave 4 — THE PLATE USES THE VERTICAL.
   *
   * An engraved museum plate sets a long name in a column: "Antonio" over
   * "Vivaldi". So the name's MEASURE is capped (in `ch` — the current font's
   * own "0"-glyph advance, so the cap follows the FACE, not just its size) and
   * the name breaks at word boundaries inside it, rather than the type
   * shrinking to fit one line — which is the trade the user asked for
   * explicitly. The plate is `width: fit-content` (asserted above), so it then
   * hugs whatever that wrapping produced: narrow and tall.
   *
   * Both halves are load-bearing. Without the measure cap the name never wraps
   * and the "vertical" is unused; without the bigger type the wrap buys
   * nothing. The size assertion is therefore a floor tied to the OLD value —
   * 1.35rem was the shrunk-to-fit size this wave replaces.
   */
  it('gives the name a measure to break in, and bigger type to break with', () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = compiled.css;
    document.head.appendChild(injectedStyle);

    const { container } = renderCard();
    const name = window.getComputedStyle(container.querySelector('.surround-composer-card__name'));

    // A measure, in `ch` of the CURRENT font — narrow enough that a two-word
    // name stacks, and font-relative so it re-derives on the webfont swap
    // (fix round 1: `em` stayed frozen at Cormorant Garamond's width, so a
    // wider fallback face — Georgia, painted first under `display=swap` —
    // fit fewer characters in the same physical measure and could clip a name
    // that would have fit in Cormorant). happy-dom does not resolve `ch` to
    // px in computed style (unlike `em`), so both checks below read the raw
    // computed value, which stays the literal `"12ch"` string.
    expect(compiled.css.replace(/\s+/g, ' '))
      .toMatch(/\.surround-composer-card__name \{[^}]*max-width: [\d.]+ch/);
    expect(name.getPropertyValue('max-width')).toMatch(/^\d+(\.\d+)?ch$/);
    expect(parseFloat(name.getPropertyValue('max-width'))).toBeLessThan(16); // < 16ch
    // Breaking, not shrinking: bigger than the one-line size it replaces.
    expect(parseFloat(name.getPropertyValue('font-size'))).toBeGreaterThan(1.35 * 16);
    // ...and it breaks at WORD boundaries by preference.
    expect(name.getPropertyValue('text-wrap')).toBe('balance');
    expect(name.getPropertyValue('overflow-wrap')).toBe('break-word');
  });

  // Both lines on the brass get the same engraved treatment — the dates read as
  // more engraving, not a sticker laid on top of the metal.
  it('engraves the dates the same way as the name — multiply blend, scoped to the plate', () => {
    const css = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss')).css.replace(/\s+/g, ' ');
    expect(css).toMatch(
      /\.surround-composer-card__nameplate \.surround-composer-card__name,\s*\.surround-composer-card__nameplate \.surround-composer-card__dates\s*\{[^}]*mix-blend-mode:\s*multiply/,
    );
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
    for (const name of ['segment-map', 'cue-ticker', 'composer-card']) {
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
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
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

  /**
   * Design wave 5 — CENTRED IN BOTH AXES, and sized to the room it is in.
   *
   * `text-align: center` was only ever half the job: a one- or two-line fact in
   * a three-line reserve hung from the top of the box and left the spare line
   * below it, which is the top-heavy gap the design review named. `grid` +
   * `align-content: center` is what actually centres wrapped text vertically —
   * `-webkit-box-pack` does not, because the clamp idiom's `display` computes
   * to `flow-root` in current Chromium (wave 2, flag 4) and takes its own
   * alignment with it. Measured in the harness before it was written: in a 62px
   * box, one line lands at y=22 under grid and at y=1 under the box idiom.
   *
   * The clamp declaration is therefore GONE rather than merely unused, and its
   * absence is asserted: leaving it in would put two competing layout modes on
   * one element, which is exactly the state this wave is unpicking elsewhere.
   */
  it('centres the fact in its reserve, in both axes', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const { getByTestId } = renderCard({ composer: { ...DATA.composer, facts: ['A fact.'] } });
    const style = window.getComputedStyle(getByTestId('surround-composer-fact'));
    expect(style.getPropertyValue('text-align')).toBe('center');
    expect(style.getPropertyValue('text-wrap')).toBe('balance');
    expect(style.getPropertyValue('display')).toBe('grid');
    expect(style.getPropertyValue('align-content')).toBe('center');
    const rule = css.match(/\.surround-composer-card__fact \{[^}]*\}/)[0];
    expect(rule, 'the line-clamp idiom is still fighting the grid').not.toContain('-webkit-line-clamp');
  });

  /**
   * Design wave 5 — TYPE THAT FILLS ITS ROOM. A flat 0.95rem was fine print in
   * the tall card a 1080p rail hands this panel. `cqh` sizes it against the
   * CARD, which is why the card had to become a size container; the clamp's ends
   * are the design's (ten-foot floor, and the point at which a bio fact would
   * out-shout the composer's own name on the brass above it).
   */
  it('sizes the fact against the card it was given, between a floor and a ceiling', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css, 'the card is not a container, so cqh would resolve against the viewport')
      .toMatch(/\.surround-composer-card \{[^}]*container-type: size/);
    const fact = css.match(/\.surround-composer-card__fact \{[^}]*\}/)[0];
    const clamp = fact.match(/font-size: clamp\(([\d.]+)rem, ([\d.]+)cqh, ([\d.]+)rem\)/);
    expect(clamp, 'the fact is set at a fixed size again').not.toBeNull();
    const [, floor, per, ceiling] = clamp.map(Number);
    expect(floor, 'below the ten-foot floor').toBeGreaterThanOrEqual(0.85);
    expect(ceiling).toBeGreaterThan(floor);
    expect(ceiling, 'a bio fact set as loudly as the composer name above it').toBeLessThanOrEqual(1.4);
    // The reserve is in `em`, so it tracks the clamp instead of being a second
    // number that has to be re-derived per screen.
    expect(fact).toMatch(/min-height: [\d.]+em/);
    expect(fact).toMatch(/max-height: [\d.]+em/);
    // The coefficient has to actually BITE between the two card heights the
    // fleet produces — ~270px on the gate's 960x540 screen-root, ~360px on the
    // 1280x720 kiosk. Otherwise the clamp is decoration and the fact is pinned
    // to one end of it at every size.
    const at = (cardPx) => Math.min(Math.max(per * cardPx / 100, floor * 16), ceiling * 16);
    expect(at(270), 'the fact is pinned to its floor on every screen we ship').toBeGreaterThan(floor * 16);
    expect(at(360)).toBeGreaterThan(at(270));
  });

  // Design wave 4: the mat went DARK. A cream mat under a brass hairline was
  // the brightest mark on a screen whose subject is the video — a white border
  // on a dark wall. The plate now reads the frame's `--mat` / `--mat-edge`, and
  // must read NO paper token at all: `--programme` grounds the programme
  // panels, not the pictures. (The carousel's mat makes the same move; see
  // PlaceCarousel.test.jsx.)
  it('mounts the portrait on a dark mat, not on white paper', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-composer-card__plate \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/background: var\(--mat,/);
    expect(rule).toMatch(/inset 0 0 0 1px var\(--mat-edge,/);   // the definition line survives
    expect(rule).not.toMatch(/--programme/);
    expect(rule).not.toMatch(/--brass/);
  });

  // Wave 3: the fact moved from the foot of the card to its middle. `margin:
  // auto 0` on a flex-column child is what centres it in the height the header
  // leaves — the rule that used to carry the `auto` was the fact RULE's
  // `margin-top`, which parked the pair at the bottom instead.
  it('centres the fact zone in the height the header leaves', () => {
    withStyles();
    const { getByTestId } = renderCard({ composer: { ...DATA.composer, facts: ['A fact.'] } });
    const zone = window.getComputedStyle(getByTestId('surround-composer-fact-zone'));
    expect(zone.getPropertyValue('margin-top')).toBe('auto');
    expect(zone.getPropertyValue('margin-bottom')).toBe('auto');

    const rule = window.getComputedStyle(
      getByTestId('surround-composer-fact-zone').querySelector('.surround-composer-card__fact-rule'),
    );
    expect(rule.getPropertyValue('margin-top')).not.toBe('auto');
  });

  /**
   * Fix round 1 (review finding, CRITICAL). Same conflict as the footer ticker
   * (see CueTicker.test.jsx): grid centring and the line clamp cannot share one
   * element, and wave 5 resolved it by deleting the clamp — which left an
   * overflowing bio fact cut mid-glyph by `overflow: hidden` instead of
   * ellipsized. Several real composer facts exceed this three-line reserve.
   * The fix restores the clamp on a separate inner element (`__fact-line`) that
   * `__fact` centres, rather than reviving it on `__fact` itself.
   */
  it('clamps the fact to three, with an ellipsis, on the inner element the outer box centres', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-composer-card__fact-line \{[^}]*\}/);
    expect(rule, 'no .surround-composer-card__fact-line rule — the clamp was not restored').not.toBeNull();
    expect(rule[0]).toContain('display: -webkit-box');
    expect(rule[0]).toContain('-webkit-line-clamp: 3');
    expect(rule[0]).toContain('-webkit-box-orient: vertical');
    expect(rule[0]).toContain('overflow: hidden');

    // The clamp lives on `__fact-line`, not back on `__fact` — reviving it
    // there would reintroduce the exact `display` conflict this fix removes.
    const outer = css.match(/\.surround-composer-card__fact \{[^}]*\}/)[0];
    expect(outer).not.toContain('-webkit-line-clamp');

    const { getByTestId } = renderCard({ composer: { ...DATA.composer, facts: ['A fact.'] } });
    const outerEl = getByTestId('surround-composer-fact');
    const lineEl = outerEl.querySelector('.surround-composer-card__fact-line');
    expect(lineEl, 'the outer box has no .surround-composer-card__fact-line child').not.toBeNull();
    expect(lineEl.textContent).toBe('A fact.');
  });

  // A fact well past what three lines of this reserve can hold. As with the
  // ticker, jsdom cannot measure where the ellipsis paints, so the honest pin
  // is the clamp declaration on the element carrying the overflow text, next
  // to the reserve that bounds it.
  it('carries the clamp on an overflowing fact, not just a short one', () => {
    withStyles();
    const longFact = 'A. '.repeat(100).trim(); // 300 characters, well past the three-line reserve
    const { getByTestId } = renderCard({ composer: { ...DATA.composer, facts: [longFact] } });
    const lineEl = getByTestId('surround-composer-fact').querySelector('.surround-composer-card__fact-line');
    const style = window.getComputedStyle(lineEl);
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('3');
    expect(style.getPropertyValue('overflow')).toBe('hidden');
  });
});

/**
 * DESIGN WAVE 6 — THE PERIOD, IN THE VITALS.
 *
 * The rail can say when a composer lived (the plate does) without saying what
 * they wrote. The era is the missing half of the identity, and it is the piece's
 * era before it is the person's: Beethoven is Classical, the Eroica is Classical
 * to Romantic, and a rail sitting beside that symphony should say the latter.
 */
describe('ComposerCard — the period line', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'ComposerCard.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const period = (view) => view.container.querySelector('[data-testid="surround-composer-period"]');

  it('prefers the PIECE’s period over the composer’s', () => {
    const view = renderCard({
      data: {
        ...DATA,
        piece: { ...DATA.piece, period: 'Classical to Romantic' },
        composer: { ...DATA.composer, period: 'Classical' },
      },
    });
    expect(period(view)).toHaveTextContent('Classical to Romantic');
  });

  it('falls back to the composer’s period when the piece names none', () => {
    const view = renderCard({
      data: { ...DATA, composer: { ...DATA.composer, period: 'Baroque' } },
    });
    expect(period(view)).toHaveTextContent('Baroque');
  });

  it('renders no element at all when neither names one', () => {
    const view = renderCard();
    expect(period(view)).toBeNull();
  });

  it('treats a blank period as no period', () => {
    const view = renderCard({
      data: { ...DATA, piece: { ...DATA.piece, period: '  ' }, composer: { ...DATA.composer, period: '' } },
    });
    expect(period(view)).toBeNull();
  });

  /**
   * NOT ON THE BRASS. The plate reads name, then dates, and that is settled
   * museum convention (wave 4): a plate carries the record, and an era is an
   * editor's classification — contestable, revisable, and in this frame
   * piece-dependent. It belongs to the rail's voice, beside the birthplace.
   */
  it('sits in the identity stack, under the birthplace — never on the nameplate', () => {
    const view = renderCard({
      data: { ...DATA, piece: { ...DATA.piece, period: 'Baroque' } },
    });
    const plate = view.container.querySelector('.surround-composer-card__nameplate');
    expect(plate, 'the nameplate did not render').not.toBeNull();
    expect(plate.querySelector('[data-testid="surround-composer-period"]'),
      'the era was engraved on the brass').toBeNull();

    const identity = view.container.querySelector('[data-testid="surround-composer-identity"]');
    const kids = [...identity.children].map((el) => el.className);
    const birthplace = kids.findIndex((c) => c.includes('__birthplace'));
    const era = kids.findIndex((c) => c.includes('__period'));
    expect(era).toBeGreaterThanOrEqual(0);
    expect(era, 'place then time: the era comes after the birthplace').toBeGreaterThan(birthplace);
  });

  it('renders the identity block for a composer whose ONLY vital is a period', () => {
    const view = renderCard({
      data: {
        ...DATA,
        piece: { ...DATA.piece, period: 'Baroque' },
        composer: { portrait: 'vivaldi/portrait.jpg' },
      },
    });
    expect(period(view)).toHaveTextContent('Baroque');
  });

  it('is set as letterspaced small caps in the rail’s quiet ink, at the floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-composer-card__period \{[^}]*\}/);
    expect(rule, 'no period rule in the compiled sheet').not.toBeNull();
    expect(rule[0]).toContain('text-transform: uppercase');
    expect(Number(rule[0].match(/letter-spacing: ([\d.]+)em/)[1])).toBeGreaterThanOrEqual(0.08);
    expect(rule[0]).toMatch(/color: var\(--ink-soft,/);
    // THE FLOOR IS PUBLISHED, NOT WRITTEN DOWN (design wave 9b). A ten-foot floor
    // is an angular claim and a rem is not an angle, so `SurroundFrame` measures
    // the screen root it fills and publishes `--label-floor`; this rule reads it.
    // The fallback is the anchor root's 11.52px — 0.72rem, the number a card
    // rendered outside a frame is set at, and the one every other root scales
    // from.
    const fallbackPx = Number(rule[0].match(/font-size: var\(--label-floor, ([\d.]+)px\)/)[1]);
    expect(fallbackPx / 16, 'below the 0.72rem ten-foot floor').toBeGreaterThanOrEqual(0.72);
    // Quieter than the birthplace above it is not the goal — it must not be
    // LOUDER than the name on the brass, which is 1.75rem.
    expect(fallbackPx / 16).toBeLessThan(1.75);
  });

  /**
   * IT WRAPS, IT DOES NOT ELLIPSIZE. "Classical to Romantic" is 21 tracked
   * characters against an identity column measured at 145px on the 960x540
   * screen-root — it needs two lines there and takes one at 1280x720 and above.
   * The birthplace's single-line ellipsis would print "CLASSICAL TO ROM…" and
   * hide exactly the half of the answer this line exists to give; shrinking
   * breaks the ten-foot floor. Wrapping costs nothing: the line is static per
   * item, so no reserve law applies, and the fact zone below is centred by
   * `margin: auto 0` and simply moves.
   */
  it('wraps to a second line rather than ellipsizing half the era away', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-composer-card__period \{[^}]*\}/)[0];
    expect(rule, 'the era is ellipsized like the birthplace').not.toContain('text-overflow');
    expect(rule).not.toContain('white-space: nowrap');
    const cap = rule.match(/max-height: ([\d.]+)em/);
    expect(cap, 'the era line has no ceiling at all').not.toBeNull();
    const lh = Number(rule.match(/line-height: ([\d.]+)/)[1]);
    expect(Number(cap[1]), 'the era may take more than two lines').toBeCloseTo(lh * 2, 2);

    // ...and the birthplace above it still takes the OTHER branch, unchanged.
    const place = css.match(/\.surround-composer-card__birthplace \{[^}]*\}/)[0];
    expect(place).toContain('white-space: nowrap');
    expect(place).toContain('text-overflow: ellipsis');
  });

  /**
   * Fix round 1 (review finding M3). "Wraps, does not ellipsize" was true of
   * the CEILING (asserted above) but not of what happened if an era ever
   * exceeded it: the outer box's own `overflow: hidden` cut it wherever the
   * box edge fell, glyph included, with no ellipsis to say the cut happened.
   * The house inner-line clamp pattern (CueTicker, EraTimeline's note) fixes
   * that: the outer keeps the ceiling, an inner span does the truncating.
   */
  it('clamps the era to two lines with an ellipsis on the inner element the outer box bounds', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-composer-card__period-line \{[^}]*\}/);
    expect(rule, 'no .surround-composer-card__period-line rule — the clamp was not added').not.toBeNull();
    expect(rule[0]).toContain('display: -webkit-box');
    expect(rule[0]).toContain('-webkit-line-clamp: 2');
    expect(rule[0]).toContain('-webkit-box-orient: vertical');
    expect(rule[0]).toContain('overflow: hidden');

    // The markup actually nests them: `__period-line` is what `__period`
    // bounds, not a sibling or a class that never renders.
    const view = renderCard({
      data: { ...DATA, piece: { ...DATA.piece, period: 'Classical to Romantic' } },
    });
    const outer = period(view);
    const inner = outer.querySelector('.surround-composer-card__period-line');
    expect(inner, 'the outer box has no .surround-composer-card__period-line child').not.toBeNull();
    expect(inner.textContent).toBe('Classical to Romantic');
  });
});

/**
 * SMART QUOTES AT THE RENDER SEAM (design wave 7). The rail's facts are the
 * frame's densest prose and carry more possessives than anything else it prints.
 */
describe('ComposerCard — smart quotes', () => {
  const mount = (composer, piece = null) => render(
    <ComposerCard
      position={0} duration={0} playing={false} seeking={false}
      data={{ contentId: 'x', composer, piece, assetBase: 'library/classical' }}
      region={{ module: 'composer-card' }} logger={makeLogger()}
    />,
  );

  it('curls a fact’s possessives — the real Vivaldi collection title', () => {
    const view = mount({
      name: 'Antonio Vivaldi',
      facts: ["Spring opened Il cimento dell'armonia e dell'inventione."],
    });
    expect(view.getByTestId('surround-composer-fact').textContent)
      .toBe('Spring opened Il cimento dell’armonia e dell’inventione.');
  });

  it('curls the name and the birthplace', () => {
    const view = mount({ name: "Adam de la Halle's circle", birthplace: "Arras, in the Count's lands" });
    expect(view.container.textContent).toContain('Halle’s');
    expect(view.container.textContent).toContain('Count’s');
    expect(view.container.textContent).not.toContain("'");
  });

  it('curls a period note carried on the era line', () => {
    const view = mount({ name: 'X' }, { period: "The composer's own century" });
    expect(view.getByTestId('surround-composer-period').textContent).toContain('composer’s');
  });
});

/**
 * NULL DISCIPLINE — the module's own stated law, applied to the module
 * (wave 8, critique finding §1.2).
 *
 * WorkPlacard, PlaceCarousel and CountryMapModule all render null on empty data
 * and say why in their headers. This card returned its outer element
 * unconditionally, and the store's composer merge always yields an OBJECT —
 * possibly an empty one — so a corpus with a sidecar and no composer put an
 * empty oxblood panel in the rail: an absence the viewer has to look at.
 *
 * TO GO RED: remove the `if (!hasHeader && !shownFact.text) return null` guard.
 */
describe('ComposerCard — nothing authored, nothing drawn', () => {
  const renderWith = (composer) => render(
    <ComposerCard
      position={0} duration={0} playing={false} seeking={false}
      data={{ contentId: 'plex:1', composer, assetBase: 'library/classical' }}
      region={{ module: 'composer-card', width: '33%' }}
      logger={makeLogger()}
    />,
  );

  it('renders nothing at all for the empty object the store’s merge can produce', () => {
    expect(renderWith({}).container.querySelector('[data-testid="surround-composer-card"]'))
      .toBeNull();
  });

  it('renders nothing when there is no composer key on the payload', () => {
    expect(renderWith(undefined).container.querySelector('[data-testid="surround-composer-card"]'))
      .toBeNull();
  });

  it('renders the card for the least a composer can be — one fact and no identity', () => {
    const { container } = renderWith({ facts: ['He moved to Vienna at twenty-one.'] });
    expect(container.querySelector('[data-testid="surround-composer-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surround-composer-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-composer-fact"]').textContent)
      .toContain('Vienna');
  });
});
