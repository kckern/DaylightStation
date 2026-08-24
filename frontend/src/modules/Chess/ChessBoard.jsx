import { memo, useEffect, useMemo, useRef } from 'react';
import {
  FILES, RANKS, diffPositions, fenToPosition, orderedSquares, squareColor,
} from '@shared-gaming/rulesets/chess/index.mjs';
import { pieceSource } from './pieceAssets.js';
import './ChessBoard.scss';

/**
 * The board, shared by every surface that shows one.
 *
 * It knows squares, not what a square means. The rim reads a-h and 1-8 unless a
 * host supplies its own `fileLabels`/`rankLabels` — which is how the piano kiosk
 * gets a rim of chord names without this component ever learning what a chord
 * is. Labels stay on the rim: a name in all 64 cells is noise to read past.
 * `squareLabels` is the deliberate exception — a SPARSE map a host may put on
 * the handful of squares that matter right now (the piano labels the held
 * piece's destinations). It defaults to empty and renders nothing.
 *
 * Colour comes entirely from CSS custom properties, so a host restyles the board
 * by setting tokens rather than by overriding selectors.
 */

const MOVE_DURATION_MS = 240;
const CAPTURE_FADE_MS = 240;
const MOVE_EASING = 'cubic-bezier(0.33, 0.9, 0.36, 1)';

/** The king in check, so the board can mark it. */
function findCheckedKing(position, status) {
  if (!status?.check) return null;
  const king = `${status.turn}K`;
  return Object.keys(position).find((square) => position[square] === king) ?? null;
}

/**
 * The mated king, which topples.
 *
 * Distinct from `findCheckedKing` even though both resolve to the same square
 * at mate: check is a state that can be answered, and mate is the end of the
 * game. They earn different marks, and reusing one for the other would leave
 * the last position of a game looking like an ordinary check.
 */
function findMatedKing(position, status) {
  if (!status?.game_over || status.outcome !== 'checkmate') return null;
  // The loser is whoever is to move and cannot.
  const king = `${status.turn}K`;
  return Object.keys(position).find((square) => position[square] === king) ?? null;
}

/** Column/row a square occupies on screen, which depends on which way the board faces. */
function screenCell(square, orientation) {
  const file = FILES.indexOf(square[0]);
  const rank = RANKS.indexOf(square[1]);
  return orientation === 'black' ? [7 - file, rank] : [file, 7 - rank];
}

/**
 * One square.
 *
 * Memoized, and that is not an optimisation detail — it is what makes the piano
 * host viable. MIDI notes arrive in bursts (a held chord is 3-5 events in about
 * 100ms) and each one re-renders the host. Unmemoized, every note reconciled all
 * 64 of these subtrees and their ~32 images. Every prop below is a primitive
 * except `onSelect`, which the host holds stable, so the default shallow compare
 * is exactly right.
 */
const Square = memo(function Square({
  square, piece, isLight, isSelected, isDestination, isLastMove,
  isCursor, isCandidate, isCheck, isHint, isBest, isHeld, isRejected, isMated,
  isPromotion, onSelect, ghostPiece, label,
}) {
  const classes = [
    'chess-board__square',
    isLight ? 'chess-board__square--light' : 'chess-board__square--dark',
    // channel 1 — light: what the hands are doing now
    isCandidate && 'chess-board__square--candidate',
    isCursor && 'chess-board__square--cursor',
    // channel 2 — outline: committed state
    isSelected && 'chess-board__square--selected',
    isLastMove && 'chess-board__square--last-move',
    isHeld && 'chess-board__square--held',
    // channel 3 — marks: only what was asked for
    isDestination && 'chess-board__square--destination',
    isHint && 'chess-board__square--hint',
    isBest && 'chess-board__square--best',
    // channel 4 — colour: alarms
    isCheck && 'chess-board__square--check',
    isRejected && 'chess-board__square--rejected',
    // The end of the game, and the one promotion moment. Both act on the piece
    // rather than the square, so neither joins the four --sq-* layers.
    isMated && 'chess-board__square--mated',
    isPromotion && 'chess-board__square--promoted',
  ].filter(Boolean).join(' ');

  /**
   * A button only when there is something to press.
   *
   * No host in this app passes `onSelect` — the piano drives the board from
   * MIDI, and every square rendered here was a `<button disabled>` inside a
   * `role="grid"`: wrong semantics for assistive tech, a focus stop that goes
   * nowhere, and sixty-four elements carrying interactive machinery for a
   * board nobody can click. The interactive form is still exactly what it was
   * for any host that does supply a handler.
   */
  const Tag = onSelect ? 'button' : 'div';
  const interactive = onSelect
    ? { type: 'button', onClick: () => onSelect(square) }
    : { role: 'gridcell' };

  return (
    <Tag
      className={classes}
      data-square={square}
      aria-label={piece ? `${square} — ${piece}` : square}
      {...interactive}
    >
      {isDestination && !piece && <span className="chess-board__dot" aria-hidden="true" />}
      {/* The alarm layer. A real child, NOT `::after` — that pseudo-element is
          already claimed by the hint dot, and a checked king can also be one of
          the player's movable pieces, so the two would silently fight. This
          board has been bitten by exactly that once before (see --best and
          --held below). One element, two animations, selected by class. */}
      {(isCheck || isRejected) && (
        <span
          className={`chess-board__flash${isRejected ? ' chess-board__flash--refuse' : ' chess-board__flash--check'}`}
          aria-hidden="true"
        />
      )}
      {/* A child element, not the square's ::before — --best already owns that
          pseudo-element, and the piece in hand can also be the engine's
          suggested move. Two rules on one pseudo-element would silently drop
          one of them. */}
      {isHeld && <span className="chess-board__held-ants" aria-hidden="true" />}
      {piece && (
        <img className="chess-board__piece" src={pieceSource(piece)} alt="" draggable="false" />
      )}
      {/* After the piece, and lifted above its z-index in CSS: on a capture
          square the badge must ride the corner, not vanish under the artwork. */}
      {label && (
        <span className="chess-board__badge" aria-hidden="true">{label}</span>
      )}
      {ghostPiece && (
        <img
          className="chess-board__piece chess-board__piece--ghost"
          src={pieceSource(ghostPiece)}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      )}
    </Tag>
  );
});

export function ChessBoard({
  fen,
  status = null,
  orientation = 'white',
  fileLabels = FILES,
  rankLabels = RANKS,
  selected = null,
  destinations = [],
  lastMove = null,
  cursorSquare = null,
  candidates = [],
  hintTargets = [],
  bestMove = null,
  heldSquare = null,
  squareLabels = {},
  rejectedSquare = null,
  rejectedKey = null,
  ghost = null,
  onSelect = null,
  className = '',
  /**
   * Changes whenever the rim labels are re-dealt.
   *
   * Used only as a React key on the axis labels, which remounts them and so
   * replays their entrance animation. The board never reads its value — a host
   * that re-deals nothing simply never changes it.
   */
  dealKey = null,
  /**
   * A square a pawn has just become something else on.
   *
   * Auto-queening happened with no acknowledgement at all: a pawn turned into a
   * queen and the only evidence was the artwork changing between two frames.
   */
  promotedSquare = null,
  /**
   * How long a piece takes to cross the board.
   *
   * A prop because the two actors need different tempos: your own move should
   * feel immediate (you caused it and already know what it was), while the
   * opponent's needs long enough to be followed by someone who was looking
   * elsewhere. Defaulted so every other host of this board is unaffected.
   */
  moveDurationMs = MOVE_DURATION_MS,
}) {
  const position = useMemo(() => fenToPosition(fen) || {}, [fen]);
  const squares = useMemo(() => orderedSquares(orientation), [orientation]);

  const boardRef = useRef(null);
  const previousPosition = useRef(position);

  /**
   * Pieces slide rather than teleport.
   *
   * Driven off a diff of two positions, not off the move that caused it, so the
   * player's move and the opponent's reply animate through the same path — and
   * so do undo, a reload, and a spectator arriving mid-game, none of which have
   * a move object to work from.
   */
  useEffect(() => {
    const operations = diffPositions(previousPosition.current, position);
    previousPosition.current = position;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    const cleanups = [];
    for (const operation of operations) {
      if (operation.type === 'move') {
        const element = boardRef.current?.querySelector(`[data-square="${operation.to}"] .chess-board__piece`);
        if (!element?.animate) continue;
        const [fromColumn, fromRow] = screenCell(operation.from, orientation);
        const [toColumn, toRow] = screenCell(operation.to, orientation);
        element.animate(
          [
            // The piece is square-sized, so a whole percent is a whole square.
            { transform: `translate(${(fromColumn - toColumn) * 100}%, ${(fromRow - toRow) * 100}%) scale(1)`, offset: 0 },
            // The landing settle, composed into the same animation rather than
            // handed to a separate CSS keyframe: two animations on one element
            // fight over `transform`, and the loser is whichever the browser
            // decides. One compositor animation, one property, no conflict.
            { transform: 'translate(0, 0) scale(1.06)', offset: 0.82 },
            { transform: 'translate(0, 0) scale(1)', offset: 1 },
          ],
          { duration: moveDurationMs, easing: MOVE_EASING },
        );
        continue;
      }

      /**
       * A captured piece used to vanish on the frame its taker rendered — the
       * single most-missed event on the board, and the reason a player can look
       * up and not know what they just lost.
       *
       * It has to be a detached clone: by the time this runs, React has already
       * replaced the square's contents with the arriving piece, so there is no
       * element left to fade. The clone sits BELOW the taker (z-index 0 against
       * the piece's 1), which is what makes the capture read correctly — the
       * victim is visible for as long as the taker is still sliding in, and is
       * covered exactly when it arrives. `from` rather than the move's `to`, so
       * an en-passant pawn fades on the square it actually stood on.
       */
      if (operation.type !== 'clear') continue;
      const host = boardRef.current?.querySelector(`[data-square="${operation.from}"]`);
      if (!host) continue;
      const clone = document.createElement('img');
      clone.className = 'chess-board__piece chess-board__piece--captured';
      clone.src = pieceSource(operation.piece);
      clone.alt = '';
      clone.setAttribute('aria-hidden', 'true');
      host.appendChild(clone);
      const remove = () => clone.remove();
      if (!clone.animate) { remove(); continue; }
      const animation = clone.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.7)' },
        ],
        { duration: CAPTURE_FADE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      );
      animation.onfinish = remove;
      // A board that unmounts (or re-diffs) mid-fade must not leave the clone
      // parked on the square forever.
      cleanups.push(() => { animation.cancel(); remove(); });
    }
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [orientation, position, moveDurationMs]);

  const checkedKing = findCheckedKing(position, status);
  const matedKing = findMatedKing(position, status);
  const destinationSet = useMemo(() => new Set(destinations), [destinations]);
  const candidateSet = useMemo(() => new Set(candidates), [candidates]);
  const hintSet = useMemo(() => new Set(hintTargets), [hintTargets]);

  /**
   * Which rim labels are live.
   *
   * The candidates, not just the resolved cursor: in the reading vocabulary one
   * note narrows to a whole rank or file, and lighting its label is what shows
   * the player that half the address has landed — the row and the column
   * visibly meeting is the whole lesson. The cursor is included so the labels
   * stay lit once the address resolves.
   */
  const liveFiles = useMemo(() => {
    const set = new Set([...candidateSet].map((square) => square[0]));
    if (cursorSquare) set.add(cursorSquare[0]);
    // Every file lit is the same as none lit — it says nothing, and it makes
    // the rim flicker on the first note of every chord.
    return set.size === FILES.length ? new Set(cursorSquare ? [cursorSquare[0]] : []) : set;
  }, [candidateSet, cursorSquare]);

  const liveRanks = useMemo(() => {
    const set = new Set([...candidateSet].map((square) => square[1]));
    if (cursorSquare) set.add(cursorSquare[1]);
    return set.size === RANKS.length ? new Set(cursorSquare ? [cursorSquare[1]] : []) : set;
  }, [candidateSet, cursorSquare]);

  const files = orientation === 'black' ? [...FILES].reverse() : [...FILES];
  const ranks = orientation === 'black' ? [...RANKS] : [...RANKS].reverse();

  // Labels are indexed by file/rank position, so a host hands over eight of each
  // and never has to know which way the board is currently facing.
  const fileLabel = (file) => fileLabels[FILES.indexOf(file)] ?? file;
  const rankLabel = (rank) => rankLabels[RANKS.indexOf(rank)] ?? rank;

  return (
    <div className={`chess-board-frame${className ? ` ${className}` : ''}`}>
      <div className="chess-board__rank-axis" aria-hidden="true">
        {ranks.map((rank, index) => (
          <span
            // Keyed on the deal as well as the rank: a re-deal remounts these,
            // which is what replays the entrance animation below. The map
            // changing under a player mid-game is the most disorienting thing
            // this board does, and it used to be announced only by a caption in
            // a rail nobody is looking at.
            key={`${dealKey ?? ''}:${rank}`}
            className={[
              'chess-board__axis-label',
              liveRanks.has(rank) && 'chess-board__axis-label--live',
              dealKey && 'chess-board__axis-label--dealt',
            ].filter(Boolean).join(' ')}
            style={dealKey ? { animationDelay: `${index * 40}ms` } : undefined}
          >
            {rankLabel(rank)}
          </span>
        ))}
      </div>

      <div className="chess-board" role="grid" aria-label="Chess board" ref={boardRef}>
        {squares.map((square) => (
          <Square
            // The rejection key is part of the identity of a refused square, so
            // repeating the same mistake remounts it and replays the flash.
            key={rejectedSquare === square ? `${square}:${rejectedKey}` : square}
            square={square}
            piece={position[square]}
            isLight={squareColor(square) === 'light'}
            isSelected={selected === square}
            isDestination={destinationSet.has(square)}
            isCandidate={candidateSet.has(square)}
            isHint={hintSet.has(square)}
            isBest={bestMove?.from === square || bestMove?.to === square}
            isHeld={heldSquare === square}
            isLastMove={lastMove?.from === square || lastMove?.to === square}
            isCursor={cursorSquare === square}
            isCheck={checkedKing === square}
            isMated={matedKing === square}
            isPromotion={promotedSquare === square}
            isRejected={rejectedSquare === square}
            ghostPiece={ghost?.square === square ? ghost.piece : null}
            label={squareLabels[square] ?? null}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="chess-board__file-axis" aria-hidden="true">
        {files.map((file, index) => (
          <span
            key={`${dealKey ?? ''}:${file}`}
            className={[
              'chess-board__axis-label',
              liveFiles.has(file) && 'chess-board__axis-label--live',
              dealKey && 'chess-board__axis-label--dealt',
            ].filter(Boolean).join(' ')}
            // Continues the sweep round the rim rather than restarting it, so
            // the two axes read as one gesture.
            style={dealKey ? { animationDelay: `${(index + 8) * 40}ms` } : undefined}
          >
            {fileLabel(file)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(ChessBoard);
