import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as sass from 'sass';
import { fileURLToPath } from 'url';
import { INITIAL_FEN, applyMove, describePosition } from '@shared-gaming/chess/index.mjs';
import ChessBoard from './ChessBoard.jsx';
import { pieceSource } from './pieceAssets.js';

// jsdom never computes CSS, so nothing above this line can tell us whether two
// channels actually render together on one square — a class-name assertion would
// stay green even while box-shadow silently overwrote itself. This block compiles
// the real stylesheet and inspects the generated declarations instead.
const scssPath = fileURLToPath(new URL('./ChessBoard.scss', import.meta.url));
const compiledCss = sass.compile(scssPath).css;

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = compiledCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

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
      expect(calls[0].frames[0].transform).toContain('translate(0%, 200%)');
      // The last frame is home, at rest — the settle overshoot in between must
      // resolve rather than leave the piece scaled.
      expect(calls[0].frames.at(-1).transform).toBe('translate(0, 0) scale(1)');
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
      expect(calls[0][0].transform).toContain('translate(0%, -200%)');
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
    expect(container.querySelectorAll('.chess-board__square--muted')).toHaveLength(0);
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

describe('the piece in hand', () => {
  it('marks the held square and only that square', () => {
    const { container } = render(<ChessBoard fen={START} heldSquare="e2" />);
    const held = container.querySelectorAll('.chess-board__square--held');
    expect(held).toHaveLength(1);
    expect(held[0].closest('[data-square]').dataset.square).toBe('e2');
  });

  it('marks nothing when no piece is in hand', () => {
    const { container } = render(<ChessBoard fen={START} heldSquare={null} />);
    expect(container.querySelectorAll('.chess-board__square--held')).toHaveLength(0);
  });
});

describe('destination labels', () => {
  it('prints the chord on a labelled square without hiding the piece', () => {
    const { container } = render(<ChessBoard fen={START} squareLabels={{ e4: 'Fm7' }} />);
    const badge = container.querySelector('.chess-board__badge');
    expect(badge.textContent).toBe('Fm7');
    expect(badge.closest('[data-square]').dataset.square).toBe('e4');
  });

  it('prints nothing when there are no labels', () => {
    const { container } = render(<ChessBoard fen={START} squareLabels={{}} />);
    expect(container.querySelectorAll('.chess-board__badge')).toHaveLength(0);
  });

  it('stays inert for hosts that pass no labels at all', () => {
    // ChessLessons renders this board with none of the piano props; the default
    // must be an empty map, not a crash or a stray badge.
    const { container } = render(<ChessBoard fen={START} />);
    expect(container.querySelectorAll('.chess-board__badge')).toHaveLength(0);
  });

  it('labels a capture square, where a piece is already standing', () => {
    // Black pawn on e5; the label must coexist with it.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { container } = render(<ChessBoard fen={fen} squareLabels={{ e5: 'Bb' }} />);
    const square = container.querySelector('[data-square="e5"]');
    expect(square.querySelector('.chess-board__badge').textContent).toBe('Bb');
    expect(square.querySelector('.chess-board__piece')).not.toBeNull();
  });

  it('stacks the badge above the piece, which paints at z-index 1 (compiled CSS)', () => {
    // The corner placement only helps if the badge is actually visible there:
    // .chess-board__piece sets z-index: 1, so a badge with z-index auto would
    // paint UNDER the occupant of a capture square no matter its DOM order.
    const body = ruleBody('.chess-board__badge');
    expect(body).not.toBeNull();
    const z = body.match(/z-index\s*:\s*(\d+)/);
    expect(z, 'badge must set a z-index above the piece\'s 1').not.toBeNull();
    expect(Number(z[1])).toBeGreaterThan(1);
  });

  it('sizes the badge off the board token, never the viewport (compiled CSS)', () => {
    // The kiosk lays out at a fixed design size and scales the canvas, so
    // viewport units measure the wrong box.
    const body = ruleBody('.chess-board__badge');
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/\d(vw|vh|vmin|vmax)\b/);
    expect(body).toContain('var(--cb-size');
  });
});

describe('channels compose instead of overwriting (compiled CSS)', () => {
  // jsdom cannot compute box-shadow or ::before/::after, so these assertions run
  // against the actual compiled stylesheet, not the DOM. They guard the specific
  // way box-shadow silently discards competing declarations: a class-name test
  // would stay green even while one channel erased another's shadow.

  it('sets box-shadow exactly once on the square, composed from --sq-* layers', () => {
    const body = ruleBody('.chess-board__square');
    expect(body).not.toBeNull();
    const boxShadowDeclarations = body.match(/box-shadow\s*:/g) || [];
    expect(boxShadowDeclarations).toHaveLength(1);
    for (const layer of ['--sq-light', '--sq-light-ring', '--sq-mark', '--sq-alarm']) {
      expect(body).toContain(`var(${layer}`);
    }
  });

  it('has each light/marks/alarm channel rule set a --sq-* layer, never box-shadow directly', () => {
    for (const selector of [
      '.chess-board__square--candidate',
      '.chess-board__square--cursor',
      '.chess-board__square--check',
      '.chess-board__square--destination:has(.chess-board__piece)',
    ]) {
      const body = ruleBody(selector);
      expect(body, `${selector} rule should exist`).not.toBeNull();
      expect(body, `${selector} must not set box-shadow directly — it would silently replace every other channel's shadow`).not.toMatch(/box-shadow\s*:/);
      expect(body, `${selector} must set a --sq-* layer`).toMatch(/--sq-(light|light-ring|mark|alarm)\s*:/);
    }
  });

  it('puts the best-move ring and the hint dot on different pseudo-elements so both can render', () => {
    expect(ruleBody('.chess-board__square--hint::after')).not.toBeNull();
    expect(ruleBody('.chess-board__square--best::before')).not.toBeNull();
    // A same-pseudo-element collision would silently drop the hint dot (last
    // declaration wins), so also assert best never reclaims ::after.
    expect(compiledCss).not.toMatch(/\.chess-board__square--best::after\s*\{/);
  });

  it('keeps the held-square ants off --best\'s ::before, since a held piece can also be the suggested move', () => {
    // PianoChessGame passes both heldSquare={game.origin} and bestMove={help.best}
    // to the same board — the engine can suggest moving the piece already in hand.
    // --best already owns ::before on the square, so the ants must live elsewhere
    // or one of the two rules silently loses.
    expect(ruleBody('.chess-board__square--best::before')).not.toBeNull();
    expect(compiledCss).not.toMatch(/\.chess-board__square--held::before\s*\{/);
    expect(ruleBody('.chess-board__held-ants')).not.toBeNull();
  });
});

describe('the capture, animated', () => {
  /** Stub WAAPI and hand back every element it was called on. */
  function captureAnimations() {
    const calls = [];
    const original = window.Element.prototype.animate;
    window.Element.prototype.animate = function animate(keyframes, options) {
      calls.push({ element: this, keyframes, options });
      return { cancel: () => {}, set onfinish(fn) { this._fn = fn; }, get onfinish() { return this._fn; } };
    };
    return { calls, restore: () => { window.Element.prototype.animate = original; } };
  }

  // 1. e4 e5 2. Nf3 Nc6 3. Nxe5 — the knight takes a pawn on e5.
  const before = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3';
  const after = applyMove(before, { from: 'f3', to: 'e5' }).fen;

  it('fades the taken piece out instead of vanishing it mid-frame', () => {
    const { calls, restore } = captureAnimations();
    try {
      const { container, rerender } = render(<ChessBoard fen={before} />);
      rerender(<ChessBoard fen={after} />);
      // A clone of the captured pawn is injected on the square it stood on.
      const clone = container.querySelector('.chess-board__piece--captured');
      expect(clone).toBeTruthy();
      expect(clone.closest('[data-square]').dataset.square).toBe('e5');
      const faded = calls.find((call) => call.element === clone);
      expect(faded.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    } finally {
      restore();
    }
  });

  it('leaves nothing behind on a quiet move', () => {
    const { calls, restore } = captureAnimations();
    try {
      const quiet = applyMove(INITIAL_FEN, { from: 'e2', to: 'e4' }).fen;
      const { container, rerender } = render(<ChessBoard fen={INITIAL_FEN} />);
      rerender(<ChessBoard fen={quiet} />);
      expect(container.querySelector('.chess-board__piece--captured')).toBeNull();
      expect(calls).toHaveLength(1); // the slide, and only the slide
    } finally {
      restore();
    }
  });

  it('paces the slide from the duration the host asked for', () => {
    const { calls, restore } = captureAnimations();
    try {
      const quiet = applyMove(INITIAL_FEN, { from: 'e2', to: 'e4' }).fen;
      const { rerender } = render(<ChessBoard fen={INITIAL_FEN} moveDurationMs={420} />);
      rerender(<ChessBoard fen={quiet} moveDurationMs={420} />);
      expect(calls[0].options.duration).toBe(420);
    } finally {
      restore();
    }
  });
});

describe('the render path (compiled CSS)', () => {
  it('never transitions box-shadow on a square', () => {
    // A paint property transitioned on up to eight squares at once was the
    // reported jank when the board lights up. This channel must snap.
    const body = ruleBody('.chess-board__square');
    expect(body).not.toMatch(/transition:[^;]*box-shadow/);
  });

  it('animates the held indicator on opacity, not on a repainting property', () => {
    const body = ruleBody('.chess-board__held-ants');
    expect(body).not.toMatch(/background-position/);
    expect(compiledCss).toMatch(/@keyframes chess-board-breathe/);
  });

  it('lifts the held piece with a transform', () => {
    const body = ruleBody('.chess-board__square--held .chess-board__piece');
    expect(body).toMatch(/transform:\s*translateY/);
  });

  it('draws the last move solid enough to read across a room', () => {
    const body = ruleBody('.chess-board__square--last-move');
    expect(body).toMatch(/outline:\s*3px solid/);
    expect(body).not.toMatch(/dashed/);
  });
});

describe('the end of the game, and the one promotion', () => {
  it('topples the mated king, and only the mated one', () => {
    // Fool's mate: White is mated on e1.
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const { container } = render(<ChessBoard fen={fen} status={describePosition(fen)} />);
    expect(container.querySelector('[data-square="e1"]').className).toContain('--mated');
    // The surviving king is untouched.
    expect(container.querySelector('[data-square="e8"]').className).not.toContain('--mated');
  });

  it('does not topple a king that is merely in check', () => {
    // Same board, but read as a live position rather than a finished game.
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const status = { ...describePosition(fen), game_over: false, outcome: null };
    const { container } = render(<ChessBoard fen={fen} status={status} />);
    const square = container.querySelector('[data-square="e1"]');
    expect(square.className).toContain('--check');
    expect(square.className).not.toContain('--mated');
  });

  it('marks the square a pawn promoted on, when the host names one', () => {
    const { container } = render(<ChessBoard fen={INITIAL_FEN} promotedSquare="e8" />);
    expect(container.querySelector('[data-square="e8"]').className).toContain('--promoted');
  });

  it('holds the topple at its end state under reduced motion', () => {
    // The topple is information — which king lost — so it must survive when
    // motion is reduced rather than being removed with the other animations.
    const rule = ruleBody('.chess-board__square--mated .chess-board__piece');
    expect(rule).toMatch(/animation:\s*chess-board-topple/);
    // The reduced-motion override appears later in the file and wins.
    const overrides = compiledCss.split('.chess-board__square--mated .chess-board__piece');
    expect(overrides.at(-1)).toMatch(/rotate\(70deg\)/);
  });
});

describe('the landing settle', () => {
  it('rides the slide as one animation rather than a competing CSS keyframe', () => {
    // Two animations on one element fight over `transform`, and the loser is
    // whichever the browser decides. The settle is composed into the slide.
    const calls = [];
    const original = window.Element.prototype.animate;
    window.Element.prototype.animate = function animate(frames) { calls.push(frames); return {}; };
    try {
      const { rerender } = render(<ChessBoard fen={INITIAL_FEN} />);
      rerender(<ChessBoard fen={applyMove(INITIAL_FEN, 'e4').fen} />);
      const frames = calls[0];
      expect(frames).toHaveLength(3);
      // Overshoot, then rest.
      expect(frames[1].transform).toMatch(/scale\(1\.0[0-9]\)/);
      expect(frames[2].transform).toMatch(/scale\(1\)/);
    } finally {
      window.Element.prototype.animate = original;
    }
  });

  it('leaves no orphan settle keyframe in the stylesheet', () => {
    expect(compiledCss).not.toMatch(/@keyframes chess-board-settle/);
  });
});
