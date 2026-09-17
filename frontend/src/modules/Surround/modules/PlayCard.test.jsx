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

const renderCard = ({ data = FLAT_DATA, position = 0, logger = makeLogger() } = {}) => {
  const props = (p) => ({
    position: p, duration: 7567, playing: true, seeking: false,
    data, region: { module: 'play-card', width: '33%' }, logger,
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
    expect(getSurroundRegistry().getMeta('play-card')).toEqual({ regions: ['right'] });
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
});
