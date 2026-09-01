import { describe, it, expect } from 'vitest';
import {
  layoutVideoCards,
  CAPTION_MAX_W_PX,
  CAPTION_MIN_W_PX,
  FLIP_ZONE_PX,
} from './videoCardLayout.js';

const WIDTH = 900;

describe('layoutVideoCards', () => {
  it('returns nothing for no markers', () => {
    expect(layoutVideoCards([], WIDTH)).toEqual([]);
    expect(layoutVideoCards(null, WIDTH)).toEqual([]);
  });

  it('gives a lone card the full caption budget', () => {
    const [card] = layoutVideoCards([{ x: 100 }], WIDTH);
    expect(card.captionWidth).toBe(CAPTION_MAX_W_PX);
    expect(card.flip).toBe(false);
  });

  it('stacks later cards above earlier ones', () => {
    const cards = layoutVideoCards([{ x: 50 }, { x: 300 }, { x: 550 }], WIDTH);
    expect(cards.map(c => c.zIndex)).toEqual([1, 2, 3]);
  });

  it('leaves well-separated cards at full width', () => {
    const cards = layoutVideoCards([{ x: 50 }, { x: 400 }], WIDTH);
    expect(cards[0].captionWidth).toBe(CAPTION_MAX_W_PX);
  });

  // Regression: session-20260901140036 — the warm-up card at ~2% and the Upper
  // Body card at ~16% of a ~900px plot left ~125px between them, and both
  // captions rendered at their full 140px, overlapping by ~15px of text.
  it('shrinks a caption to the room before the next card', () => {
    const cards = layoutVideoCards([{ x: 48 }, { x: 173 }], WIDTH);
    expect(cards[0].captionWidth).toBeLessThan(CAPTION_MAX_W_PX);
    // Caption must end before the neighbour's left edge (its x + the 6px offset).
    expect(48 + 6 + cards[0].captionWidth).toBeLessThanOrEqual(173 + 6);
    expect(cards[1].captionWidth).toBe(CAPTION_MAX_W_PX);
  });

  it('drops a caption with no readable room left', () => {
    const cards = layoutVideoCards([{ x: 100 }, { x: 120 }], WIDTH);
    expect(cards[0].captionWidth).toBeNull();
    expect(cards[1].captionWidth).toBe(CAPTION_MAX_W_PX);
  });

  it('keeps a caption that just clears the readability floor', () => {
    const cards = layoutVideoCards([{ x: 100 }, { x: 100 + CAPTION_MIN_W_PX + 8 }], WIDTH);
    expect(cards[0].captionWidth).toBe(CAPTION_MIN_W_PX);
  });

  it('flips a card near the right edge and budgets it leftward', () => {
    const cards = layoutVideoCards([{ x: 400 }, { x: WIDTH - 20 }], WIDTH);
    expect(cards[1].flip).toBe(true);
    expect(cards[1].captionWidth).toBe(CAPTION_MAX_W_PX);
    expect(cards[0].flip).toBe(false);
  });

  it('shrinks a flipped card that crowds the card before it', () => {
    const x = WIDTH - FLIP_ZONE_PX + 10; // just inside the flip zone
    const cards = layoutVideoCards([{ x: x - 200 }, { x }], WIDTH);
    expect(cards[1].flip).toBe(true);
    expect(cards[1].captionWidth).toBeLessThan(CAPTION_MAX_W_PX);
  });

  it('treats an unmeasured gutter as unflipped', () => {
    const cards = layoutVideoCards([{ x: 0 }], 0);
    expect(cards[0].flip).toBe(false);
    expect(cards[0].captionWidth).toBe(CAPTION_MAX_W_PX);
  });
});
