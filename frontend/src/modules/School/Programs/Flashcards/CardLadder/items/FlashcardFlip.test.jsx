import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlashcardItem from './FlashcardItem.jsx';

vi.mock('../cardLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));

const langs = { term: 'ko', gloss: 'en' };
const id = (x) => x;
const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: 'img', audio: 'aud', glossAudio: null } };
const card = () => screen.getByRole('button', { name: /flip (the card|back)/i });
const sideOf = (text) => screen.getByText(text).closest('.wl-card__side');

function stubReducedMotion(reduce) {
  const original = window.matchMedia;
  window.matchMedia = vi.fn((query) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  return () => { window.matchMedia = original; };
}

let restore = () => {};
afterEach(() => { restore(); restore = () => {}; });

describe('FlashcardItem — 3D flip', () => {
  it('Space toggles the flipped class on the card, and a tap flips back', () => {
    restore = stubReducedMotion(false);
    render(<FlashcardItem item={{ id: 'p1', type: 'flashcard', mode: 'practice', front: 'term', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(card()).not.toHaveClass('is-flipped');
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(card()).toHaveClass('is-flipped');
    fireEvent.click(card());
    expect(card()).not.toHaveClass('is-flipped');
  });

  it('the back face (picture + meaning) is aria-hidden until flipped; the front is hidden after', () => {
    restore = stubReducedMotion(false);
    render(<FlashcardItem item={{ id: 's1', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(sideOf('Scissors')).toHaveAttribute('aria-hidden', 'true');
    expect(sideOf('가위')).toHaveAttribute('aria-hidden', 'false');
    // Role queries skip aria-hidden subtrees: the picture is not reachable on the Korean front.
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(sideOf('Scissors')).toHaveAttribute('aria-hidden', 'false');
    expect(sideOf('가위')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('marks the card as flipping (will-change) only until the transform transition ends', () => {
    restore = stubReducedMotion(false);
    const { container } = render(<FlashcardItem item={{ id: 's2', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const inner = container.querySelector('.wl-card__inner');
    expect(card()).not.toHaveClass('is-flipping');
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(card()).toHaveClass('is-flipping');
    fireEvent.transitionEnd(inner, { propertyName: 'transform' });
    expect(card()).not.toHaveClass('is-flipping');
  });

  it('reduced motion takes the no-animation path: still card, never flipping', () => {
    restore = stubReducedMotion(true);
    render(<FlashcardItem item={{ id: 's3', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(card()).toHaveClass('wl-card--still');
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(card()).toHaveClass('is-flipped');
    expect(card()).not.toHaveClass('is-flipping');
  });

  it('reports item layout once, from the term, even though both faces are mounted', () => {
    restore = stubReducedMotion(false);
    const onLayout = vi.fn();
    render(<FlashcardItem item={{ id: 'p2', type: 'flashcard', mode: 'practice', front: 'gloss', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} onLayout={onLayout} />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(onLayout).toHaveBeenCalledTimes(1);
  });
});
