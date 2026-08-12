import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_FEN, describePosition } from '@shared-gaming/chess/index.mjs';
import ChessBoard from './ChessBoard.jsx';
import { pieceSource } from './pieceAssets.js';

describe('piece artwork', () => {
  it('resolves every piece to a bundled source', () => {
    for (const code of ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK']) {
      expect(pieceSource(code), code).toBeTruthy();
      expect(pieceSource(code, { rotated: true }), `${code} rotated`).toBeTruthy();
    }
    expect(pieceSource('xx')).toBe(null);
  });

  it('gives each piece its own artwork', () => {
    const sources = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'].map((c) => pieceSource(c));
    expect(new Set(sources).size).toBe(12);
  });
});

describe('ChessBoard', () => {
  it('paints 64 squares and 32 pieces from the opening position', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} />);
    expect(container.querySelectorAll('.chess-board__square')).toHaveLength(64);
    const pieces = container.querySelectorAll('.chess-board__piece');
    expect(pieces).toHaveLength(32);
    // A missing src would render 32 broken images, which is exactly the failure
    // the media route's SVG refusal would have caused.
    for (const piece of pieces) expect(piece.getAttribute('src')).toBeTruthy();
  });

  it('labels the rim algebraically by default', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} />);
    const labels = [...container.querySelectorAll('.chess-board__axis-label')].map((el) => el.textContent);
    expect(labels).toContain('a');
    expect(labels).toContain('8');
    expect(container.querySelectorAll('.chess-board__square-label')).toHaveLength(0);
  });

  it('labels the rim with chords when asked, and names every square', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} notation="chord" />);
    const labels = [...container.querySelectorAll('.chess-board__axis-label')].map((el) => el.textContent);
    expect(labels).toContain('Bb');
    expect(labels).toContain('sus4');
    expect(container.querySelectorAll('.chess-board__square-label')).toHaveLength(64);
  });

  it('flips for Black without changing the position', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} orientation="black" />);
    const squares = [...container.querySelectorAll('.chess-board__square')];
    expect(squares[0].dataset.square).toBe('h1');
    expect(squares.at(-1).dataset.square).toBe('a8');
    expect(container.querySelectorAll('.chess-board__piece')).toHaveLength(32);
  });

  it('marks selection, destinations, last move and the checked king', () => {
    // Fool's mate: Black queen on h4 has White's king in check.
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const { container } = render(
      <ChessBoard
        fen={fen}
        status={describePosition(fen)}
        selected="g4"
        destinations={['g5']}
        lastMove={{ from: 'd8', to: 'h4' }}
      />,
    );
    expect(container.querySelector('[data-square="g4"]').className).toContain('--selected');
    expect(container.querySelector('[data-square="g5"]').className).toContain('--destination');
    expect(container.querySelector('[data-square="h4"]').className).toContain('--last-move');
    expect(container.querySelector('[data-square="e1"]').className).toContain('--check');
  });

  it('throws a crosshair down the cursor file and rank', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} notation="chord" cursorSquare="c1" />);
    expect(container.querySelector('[data-square="c1"]').className).toContain('--cursor');
    expect(container.querySelector('[data-square="c5"]').className).toContain('--cursor-line');
    expect(container.querySelector('[data-square="f1"]').className).toContain('--cursor-line');
    expect(container.querySelector('[data-square="f5"]').className).not.toContain('--cursor-line');
  });

  it('is inert until a host supplies a click handler', () => {
    const { container, rerender } = render(<ChessBoard fen={INITIAL_FEN} />);
    expect(container.querySelector('[data-square="e2"]').disabled).toBe(true);

    const onSelect = vi.fn();
    rerender(<ChessBoard fen={INITIAL_FEN} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('e2 — wP'));
    expect(onSelect).toHaveBeenCalledWith('e2');
  });
});
