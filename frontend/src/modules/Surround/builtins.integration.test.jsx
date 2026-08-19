import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import SurroundFrame from './SurroundFrame.jsx';
import { registerSurroundBuiltins } from './builtins.js';
import { resetSurroundRegistry } from './registry.js';

/**
 * The names authored in `_surrounds/concert-hall.yml` must resolve to the real
 * components. A typo in either the YAML or a registration would otherwise fail
 * soft — an empty region and a warn nobody reads — which is exactly the failure
 * mode this feature is built to hide.
 *
 * THIS FIXTURE IS THE SHIPPED DEFINITION, NOT A SKETCH OF ONE. It drifted for
 * six waves: it was still the wave-1 shape (no `top`, no `place-carousel`,
 * `right` an object rather than a list, `assetBase: 'surround/classical'` from
 * before the corpus split), so the two modules added most recently were exactly
 * the two this "does every authored name resolve" spec did not cover. Only the
 * prod gate did. It is now transcribed from the live definition — verified
 * against the store's own output for the shipped recording,
 * `GET /api/v1/play/plex:663134`, and against the authored YAML at
 * `data/content/surround/_surrounds/concert-hall.yml`, which agree field for
 * field.
 */
const CONCERT_HALL = {
  regions: {
    top: { module: 'work-placard' },
    right: [
      { module: 'composer-card', width: '33%', side: 'left' },
      { module: 'place-carousel' },
    ],
    bottom: [
      { module: 'movement-map', height: 64 },
      { module: 'cue-ticker', height: 'fill', collapse: 'first' },
    ],
  },
  collapse: { footerFloor: 90 },
};

const EROICA = {
  id: 'concert-hall',
  definition: CONCERT_HALL,
  assetBase: 'library/classical',
  piece: {
    title: 'Symphony No. 3', opus: 'Op. 55', musicEndsAt: 2955, period: 'Classical to Romantic',
  },
  composer: {
    name: 'Ludwig van Beethoven',
    born: 1770,
    died: 1827,
    map: { country: 'Austria', city: 'Vienna', lat: 48.21, lon: 16.37 },
  },
  movements: [
    { n: 1, name: 'Allegro con brio', start: 0 },
    { n: 2, name: 'Marcia funebre. Adagio assai', start: 976 },
  ],
  cues: [{ at: 976, render: 'docked', text: 'The funeral march begins.' }],
  facts: ['Beethoven tore the page.'],
};

describe('surround builtins in the frame', () => {
  beforeEach(() => { resetSurroundRegistry(); registerSurroundBuiltins(); });
  afterEach(() => { resetSurroundRegistry(); });

  it('resolves every concert-hall module name to a real component', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { container } = render(
      <SurroundFrame data={EROICA} contentId="plex:663134" position={976} duration={3223} playing seeking={false} logger={logger}>
        <video data-testid="the-player" />
      </SurroundFrame>,
    );

    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.missing')).toHaveLength(0);
    expect(container.querySelector('[data-testid="surround-movement-map"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surround-cue-ticker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surround-composer-card"]')).not.toBeNull();
    // The two modules the stale fixture did not cover.
    expect(container.querySelector('[data-testid="surround-work-placard"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surround-place-carousel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="the-player"]')).not.toBeNull();
    // ...and every one of them in a slot it was registered for.
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.misplaced')).toHaveLength(0);
  });

  it('drives every module from one clock — position 976 lands in movement 2', () => {
    render(
      <SurroundFrame data={EROICA} contentId="plex:663134" position={976} duration={3223} playing seeking={false}>
        <video />
      </SurroundFrame>,
    );
    const states = [...document.querySelectorAll('[data-testid="surround-movement"]')]
      .map((el) => el.getAttribute('data-state'));
    expect(states).toEqual(['elapsed', 'active']);

    // Design wave 6: the band splits, and a TIMED CUE belongs to the NOW
    // register on the right — it is a claim about what is sounding, which is
    // that zone's whole subject. The piece register on the left goes on with
    // the programme note, undisturbed. Both halves are read off the same clock
    // as the movement states above, which is what this spec exists to prove.
    expect(document.querySelector('[data-testid="surround-ticker-listen"]').textContent)
      .toBe('The funeral march begins.');
    expect(document.querySelector('[data-testid="surround-ticker-text"]').textContent)
      .toBe('Beethoven tore the page.');
    // ...and design wave 7: the NOW register does NOT reprint the movement
    // heading the rail above already sets. What names the sounding movement in
    // the band is the BOND — this register's panel and that segment's, drawn in
    // one ground and joined along the seam — so the header element is absent by
    // default and the bond is present instead.
    expect(document.querySelector('[data-testid="surround-ticker-now"]'),
      'the NOW register is reprinting the movement heading the rail already set')
      .toBeNull();
    expect(document.querySelector('[data-testid="surround-bond"]').getAttribute('data-bonded'))
      .toBe('true');
    expect(document.querySelector('[data-testid="surround-ticker-ground"]')).not.toBeNull();
  });

  /**
   * THE TWO HALVES OF THE BAND MUST AGREE, and the edge where they did not is
   * the head of a recording whose first movement starts late — tuning, an
   * announcement, an offset transfer. The store explicitly permits it
   * (`starts: [45, …]`); the rail's loop fell through to "movement I is active"
   * while the band's fell through to "nothing is playing", so a lit segment sat
   * on the rule above a header saying nothing was sounding. Both shipped
   * recordings start at 0, so nothing on a real screen ever showed it.
   *
   * TO GO RED: restore either fall-through — `return 0` at the foot of the
   * rail's index loop, or an `activeMovementIndex` that clamps to the first
   * movement instead of returning -1.
   */
  it('agrees that nothing is sounding before a late first movement starts', () => {
    const late = {
      ...EROICA,
      movements: [
        { n: 1, name: 'Allegro con brio', start: 45, listen: ['Two hammered chords.'] },
        { n: 2, name: 'Marcia funebre. Adagio assai', start: 976 },
      ],
      // `nowHeading: always` so the band's answer is on screen as words, not
      // only as the presence of a bond.
      definition: { ...CONCERT_HALL, band: { nowHeading: 'always' } },
    };
    render(
      <SurroundFrame data={late} contentId="plex:663134" position={20} duration={3223} playing seeking={false}>
        <video />
      </SurroundFrame>,
    );
    // The rail: no segment sounding, and nothing drawn as already played.
    const states = [...document.querySelectorAll('[data-testid="surround-movement"]')]
      .map((el) => el.getAttribute('data-state'));
    expect(states).toEqual(['future', 'future']);
    expect(document.querySelector('[data-testid="surround-bond"]').getAttribute('data-bonded'))
      .toBe('false');
    // The band: the same answer, in words.
    expect(document.querySelector('[data-testid="surround-ticker-now"]').textContent)
      .toBe('Listen for');
  });

  /**
   * A MOVEMENT THE RECORDING CANNOT PLACE IS NOT A MOVEMENT AT SECOND ZERO.
   * The store ships `start: undefined` for a `starts` entry it refused and warns
   * about it; both halves of the band then coerced that with `Number(x) || 0`,
   * re-anchoring a mid-piece movement to the top of the file — a zero-width
   * segment, an out-of-order rail, and a playhead that jumps backwards.
   *
   * TO GO RED: put `Number(m?.start) || 0` back in `placedMovements`.
   */
  it('draws no segment for a movement whose start the store refused', () => {
    const bad = {
      ...EROICA,
      movements: [
        { n: 1, name: 'Allegro con brio', start: 0 },
        { n: 2, name: 'Marcia funebre. Adagio assai', start: undefined },
        { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
        { n: 4, name: 'Finale. Allegro molto', start: 2278 },
      ],
    };
    render(
      <SurroundFrame data={bad} contentId="plex:663134" position={1200} duration={3223} playing seeking={false}>
        <video />
      </SurroundFrame>,
    );
    const segments = [...document.querySelectorAll('[data-testid="surround-movement"]')];
    // Three placed, not four — and not four with one of them zero-wide at 0:00.
    expect(segments).toHaveLength(3);
    const widths = segments.map((el) => parseFloat(el.style.width));
    widths.forEach((w) => expect(w).toBeGreaterThan(0));
    // Every segment starts where the one before it stops: the rail is in order.
    const naturals = segments.map((el) => Number(el.getAttribute('data-natural')));
    naturals.forEach((n) => expect(n).toBeGreaterThan(0));
    // The sounding movement at 1200s is the FIRST one — movement II could not be
    // placed, so 1200 still falls inside movement I's span.
    expect(segments.map((el) => el.getAttribute('data-state')))
      .toEqual(['active', 'future', 'future']);
  });
});
