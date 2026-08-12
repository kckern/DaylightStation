import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_FEN, applyMove, describePosition } from '@shared-gaming/chess/index.mjs';
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
  });

  it('takes whatever labels a host supplies without knowing what they mean', () => {
    // The piano passes chord names; the board just prints eight of each.
    const { container } = render(
      <ChessBoard
        fen={INITIAL_FEN}
        fileLabels={['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb']}
        rankLabels={['maj', 'm', 'sus4', 'add2', '7', '6', 'maj7', 'dim']}
      />,
    );
    const labels = [...container.querySelectorAll('.chess-board__axis-label')].map((el) => el.textContent);
    expect(labels).toContain('Bb');
    expect(labels).toContain('sus4');
    expect(labels).toHaveLength(16);
  });

  it('renders the minor-rank label lowercase, because case is the chord notation', () => {
    // Uppercasing 'm' (minor) turns it into 'M' (major) — a label that says one
    // thing and means another. The board must print labels as stored, not upcase them.
    const { container } = render(
      <ChessBoard
        fen={INITIAL_FEN}
        rankLabels={['maj', 'm', 'sus4', 'add2', '7', '6', 'maj7', 'dim']}
      />,
    );
    const labels = [...container.querySelectorAll('.chess-board__axis-label')].map((el) => el.textContent);
    expect(labels).toContain('m');
    expect(labels).not.toContain('M');
  });

  it('keeps labels on the rim and out of the cells', () => {
    // A name in all 64 cells is noise the player has to read past.
    const { container } = render(
      <ChessBoard fen={INITIAL_FEN} fileLabels={['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb']} />,
    );
    const squares = [...container.querySelectorAll('.chess-board__square')];
    expect(squares).toHaveLength(64);
    for (const square of squares) expect(square.textContent).toBe('');
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

  it('marks only the resolved cursor square, not its file or rank', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} cursorSquare="c1" />);
    expect(container.querySelector('[data-square="c1"]').className).toContain('--cursor');
    expect(container.querySelector('[data-square="c5"]').className).not.toContain('--cursor');
    expect(container.querySelector('[data-square="f1"]').className).not.toContain('--cursor');
  });

  it('slides a moved piece from where it came', () => {
    // jsdom has no WAAPI, so stub animate() and read back the keyframes.
    const calls = [];
    const original = window.Element.prototype.animate;
    window.Element.prototype.animate = function animate(frames, options) { calls.push({ frames, options }); return { finished: Promise.resolve() }; };
    try {
      const { rerender } = render(<ChessBoard fen={INITIAL_FEN} />);
      expect(calls).toHaveLength(0);

      rerender(<ChessBoard fen={applyMove(INITIAL_FEN, 'e4').fen} />);
      expect(calls).toHaveLength(1);
      // e2 -> e4 is two ranks up the board and no sideways travel.
      expect(calls[0].frames[0].transform).toBe('translate(0%, 200%)');
      expect(calls[0].frames[1].transform).toBe('translate(0, 0)');
      expect(calls[0].options.duration).toBeGreaterThan(0);
    } finally {
      window.Element.prototype.animate = original;
    }
  });

  it('animates the opponent the same way it animates the player', () => {
    const calls = [];
    const original = window.Element.prototype.animate;
    window.Element.prototype.animate = function animate(frames) { calls.push(frames); return { finished: Promise.resolve() }; };
    try {
      const afterWhite = applyMove(INITIAL_FEN, 'e4').fen;
      const { rerender } = render(<ChessBoard fen={afterWhite} />);
      // Black's reply is a diff like any other — no move object involved.
      rerender(<ChessBoard fen={applyMove(afterWhite, 'e5').fen} />);
      expect(calls).toHaveLength(1);
      expect(calls[0][0].transform).toBe('translate(0%, -200%)');
    } finally {
      window.Element.prototype.animate = original;
    }
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

describe('ghost preview', () => {
  it('renders a translucent piece on the previewed destination', () => {
    const { container } = render(
      <ChessBoard
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        ghost={{ square: 'e4', piece: 'wP' }}
      />,
    );
    const ghost = container.querySelector('.chess-board__piece--ghost');
    expect(ghost).not.toBeNull();
    expect(ghost.closest('[data-square]')?.dataset.square).toBe('e4');
  });

  it('renders the ghost alongside the real piece on an occupied destination', () => {
    // A capture is the preview a player most wants: the ghost must not displace
    // or be suppressed by the piece already standing on the square.
    // FEN after 1.e4 e5 — rank-5 field "4p3" puts a black pawn on e5.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { container } = render(<ChessBoard fen={fen} ghost={{ square: 'e5', piece: 'wP' }} />);

    const square = container.querySelector('[data-square="e5"]');
    const images = [...square.querySelectorAll('img.chess-board__piece')];
    expect(images).toHaveLength(2);

    const ghost = square.querySelector('.chess-board__piece--ghost');
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('src')).toBe(pieceSource('wP'));

    const occupant = images.find((img) => !img.classList.contains('chess-board__piece--ghost'));
    expect(occupant.getAttribute('src')).toBe(pieceSource('bP'));
  });

  it('renders no ghost when there is nothing to preview', () => {
    const { container } = render(
      <ChessBoard fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" ghost={null} />,
    );
    expect(container.querySelector('.chess-board__piece--ghost')).toBeNull();
  });
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const sq = (container, name) => container.querySelector(`[data-square="${name}"]`);

describe('four channels', () => {
  it('lights candidates and marks the resolved cursor more strongly', () => {
    const { container } = render(<ChessBoard fen={START} candidates={['e4', 'e5', 'd4']} cursorSquare="e4" />);
    expect(sq(container, 'e5').className).toContain('chess-board__square--candidate');
    expect(sq(container, 'e4').className).toContain('chess-board__square--cursor');
  });

  it('draws no crosshair lines across the file and rank', () => {
    const { container } = render(<ChessBoard fen={START} cursorSquare="e4" />);
    expect(container.querySelectorAll('.chess-board__square--cursor-line')).toHaveLength(0);
  });

  it('shows hint marks only when hint targets are given', () => {
    const { container: quiet } = render(<ChessBoard fen={START} />);
    expect(quiet.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    const { container: asked } = render(<ChessBoard fen={START} hintTargets={['e4', 'e3']} />);
    expect(asked.querySelectorAll('.chess-board__square--hint')).toHaveLength(2);
  });

  it('rings both ends of the best move', () => {
    const { container } = render(<ChessBoard fen={START} bestMove={{ from: 'g1', to: 'f3' }} />);
    expect(sq(container, 'g1').className).toContain('chess-board__square--best');
    expect(sq(container, 'f3').className).toContain('chess-board__square--best');
  });

  it('no longer outlines movable pieces, because that is a hint now', () => {
    const { container } = render(<ChessBoard fen={START} />);
    expect(container.querySelectorAll('.chess-board__square--source')).toHaveLength(0);
  });
});
