import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import PlayCard, { PLAY_FACT_INTERVAL_MS } from './PlayCard.jsx';
import { registerSurroundBuiltins, SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry, resetSurroundRegistry } from '../registry.js';

// Compile each sheet once per file — see ComposerCard.test.jsx for why.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const FLAT_DATA = {
  contentId: 'plex:697661',
  assetBase: 'surround/drama',
  piece: { title: 'The Taming of the Shrew', genre: 'Comedy', setting: 'Padua, Italy' },
  facts: ['Written around 1590-1592.'],
  characters: [
    { name: 'Petruchio', role: 'a gentleman of Verona', description: 'A fortune-hunter.' },
  ],
  segments: [],
};

// No facts:, deliberately: with the pool built as [...facts, ...characters]
// (PlayCard.jsx), a single character card is guaranteed to land at pool[0] —
// the first thing the rotation shows — so the two positions below can be
// compared without having to drive the rotation's own timer.
const GROUPED_DATA = {
  contentId: 'plex:697661',
  assetBase: 'surround/drama',
  piece: { title: 'The Taming of the Shrew', genre: 'Comedy', setting: 'Padua, Italy' },
  characters: [
    { name: 'Petruchio', role: 'a gentleman of Verona', description: 'A fortune-hunter.' },
  ],
  segments: [
    {
      n: 1, label: 'Scene 1', contentId: 'plex:697661',
      start: 0, end: 100, offset: 0, duration: 100,
      ancestors: [{ index: 0, title: 'Act I' }],
    },
    {
      n: 1, label: 'Scene 1', contentId: 'plex:697661',
      start: 100, end: 200, offset: 100, duration: 100,
      ancestors: [{
        index: 3,
        title: 'Act IV',
        characters: [{ name: 'Petruchio', role: 'a gentleman of Verona', description: 'Deep into the taming.' }],
      }],
    },
  ],
};

const renderCard = ({
  data = FLAT_DATA,
  position = 0,
  logger = makeLogger(),
  // The region the definition placed this card in. Defaulted to the rail it
  // has always rendered in, so every existing spec is unchanged; overridden
  // by the specs that exercise a definition asking for identity only.
  region = { module: 'play-card', width: '33%' },
} = {}) => {
  const props = (p) => ({
    position: p, duration: 7567, playing: true, seeking: false,
    data, region, logger,
  });
  const view = render(<PlayCard {...props(position)} />);
  return { ...view, logger, at: (p) => view.rerender(<PlayCard {...props(p)} />) };
};

describe('PlayCard', () => {
  beforeEach(() => { resetSurroundRegistry(); registerSurroundBuiltins(); });
  afterEach(() => { resetSurroundRegistry(); });

  it('is registered under play-card, for the right rail', () => {
    expect(getSurroundRegistry().has('play-card')).toBe(true);
    expect(SURROUND_BUILTIN_MODULES).toContain('play-card');
    // THE RAIL IS WHAT THIS SPEC IS ABOUT, and that is all it should pin. The
    // full slot declaration is asserted once, in `registry.test.js`, which owns
    // it; restating the whole list here meant that every legitimate new
    // placement — the card as a strip above or below the picture, say — broke a
    // test about something else, in a file that has no opinion on the matter.
    expect(getSurroundRegistry().getMeta('play-card').regions).toContain('right');
  });

  /**
   * IDENTITY ONLY - `facts: false` on the region.
   *
   * The card's rotating fact and the listening band's LEFT register draw from
   * the same work-level pool, so a frame carrying both prints the same material
   * twice. In a rail that must also hold a timeline and both registers, that
   * duplication is what pushes the column over its height: the card measures
   * 220px with its fact and about 130px without.
   *
   * The DEFINITION decides, exactly as it decides `orientation`. The card is
   * told; it does not inspect its siblings to work out whether a ticker is
   * showing facts elsewhere - a module that changes shape based on what else is
   * mounted is the coupling this frame has spent its design avoiding.
   */
  it('renders identity only when the definition turns its facts off', () => {
    const { container } = renderCard({ region: { module: 'play-card', facts: false } });
    expect(container.querySelector('[data-testid="surround-play-header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surround-play-fact-zone"]')).toBeNull();
  });

  it('still shows the fact when the definition says nothing - every shipped rail today', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="surround-play-fact-zone"]')).not.toBeNull();
  });


  it('renders the play’s own identity — title, genre, setting', () => {
    const { container } = renderCard();
    expect(container.querySelector('.surround-play-card__title')).toHaveTextContent('The Taming of the Shrew');
    expect(container.querySelector('.surround-play-card__genre')).toHaveTextContent('Comedy');
    expect(container.querySelector('.surround-play-card__setting')).toHaveTextContent('Padua, Italy');
  });

  it('rotates through work-level facts and character cards in one pool', () => {
    const { container } = renderCard();
    const text = container.querySelector('.surround-play-card__fact-line')?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('renders nothing when the payload carries no piece identity and no facts at all', () => {
    const { container } = renderCard({ data: { contentId: 'plex:1', assetBase: 'surround/drama', segments: [] } });
    expect(container.querySelector('.surround-play-card')).toBeNull();
  });

  it('stays on the work-level character card for a FLAT work with no groups', () => {
    const { container } = renderCard({ data: FLAT_DATA, position: 0 });
    // The only Petruchio card this fixture has is the work-level one.
    expect(container.querySelector('.surround-play-card__fact-line')?.textContent ?? '')
      .not.toBe('');
  });

  it('scopes the character pool to the current Act on a GROUPED work', () => {
    // Position 50 lands in segment 0 (Act I) — no Act-level override there,
    // so the work-level Petruchio card (fortune-hunter) is what's shown.
    const early = renderCard({ data: GROUPED_DATA, position: 50 });
    expect(early.container.querySelector('.surround-play-card__fact-line'))
      .toHaveTextContent('A fortune-hunter.');

    // Position 150 lands in segment 1 (Act IV) — its own characters:
    // override replaces the work-level card by name.
    const late = renderCard({ data: GROUPED_DATA, position: 150 });
    expect(late.container.querySelector('.surround-play-card__fact-line'))
      .toHaveTextContent('Deep into the taming.');
  });

  it('renders facts only when the definition turns its identity off', () => {
    const { container } = renderCard({ region: { module: 'play-card', identity: false } });
    expect(container.querySelector('[data-testid="surround-play-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-play-fact-zone"]')).not.toBeNull();
  });

  it('renders nothing when identity is off and there is no fact to carry', () => {
    const { container } = renderCard({
      data: { contentId: 'plex:1', assetBase: 'surround/drama', piece: { title: 'X' }, segments: [] },
      region: { module: 'play-card', identity: false, facts: false },
    });
    expect(container.querySelector('.surround-play-card')).toBeNull();
  });
});
