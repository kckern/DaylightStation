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
 */
const CONCERT_HALL = {
  id: 'concert-hall',
  regions: {
    right: { width: '20%', module: 'composer-card' },
    bottom: [
      { module: 'movement-map', height: 60 },
      { module: 'cue-ticker', height: 156, collapse: 'first' },
    ],
  },
  collapse: { footerFloor: 90 },
};

const EROICA = {
  id: 'concert-hall',
  definition: CONCERT_HALL,
  assetBase: 'surround/classical',
  piece: { title: 'Symphony No. 3', opus: 'Op. 55', musicEndsAt: 2955 },
  composer: { name: 'Ludwig van Beethoven', born: 1770, died: 1827 },
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
    expect(container.querySelector('[data-testid="the-player"]')).not.toBeNull();
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
    expect(document.querySelector('[data-testid="surround-ticker-text"]').textContent)
      .toBe('The funeral march begins.');
  });
});
