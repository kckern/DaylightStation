import { memo, useEffect, useMemo, useRef } from 'react';
import {
  FILES, RANKS, diffPositions, fenToPosition, orderedSquares, squareColor,
} from '@shared-gaming/chess/index.mjs';
import { pieceSource } from './pieceAssets.js';
import './ChessBoard.scss';

/**
 * The board, shared by every surface that shows one.
 *
 * It knows squares, not what a square means. The rim reads a-h and 1-8 unless a
 * host supplies its own `fileLabels`/`rankLabels` — which is how the piano kiosk
 * gets a rim of chord names without this component ever learning what a chord
 * is. Labels stay on the rim: a name in all 64 cells is noise to read past.
 *
 * Colour comes entirely from CSS custom properties, so a host restyles the board
 * by setting tokens rather than by overriding selectors.
 */

const MOVE_DURATION_MS = 240;

/** The king in check, so the board can mark it. */
function findCheckedKing(position, status) {
  if (!status?.check) return null;
  const king = `${status.turn}K`;
  return Object.keys(position).find((square) => position[square] === king) ?? null;
}

/** Column/row a square occupies on screen, which depends on which way the board faces. */
function screenCell(square, orientation) {
  const file = FILES.indexOf(square[0]);
  const rank = RANKS.indexOf(square[1]);
  return orientation === 'black' ? [7 - file, rank] : [file, 7 - rank];
}

function Square({
  square, piece, isLight, isSelected, isDestination, isLastMove,
  isCursor, isCandidate, isCheck, isHint, isBest, isHeld, isRejected, onSelect,
  ghostPiece,
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
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      data-square={square}
      aria-label={piece ? `${square} — ${piece}` : square}
      onClick={onSelect ? () => onSelect(square) : undefined}
      disabled={!onSelect}
    >
      {isDestination && !piece && <span className="chess-board__dot" aria-hidden="true" />}
      {/* A child element, not the square's ::before — --best already owns that
          pseudo-element, and the piece in hand can also be the engine's
          suggested move. Two rules on one pseudo-element would silently drop
          one of them. */}
      {isHeld && <span className="chess-board__held-ants" aria-hidden="true" />}
      {piece && (
        <img className="chess-board__piece" src={pieceSource(piece)} alt="" draggable="false" />
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
    </button>
  );
}

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
  rejectedSquare = null,
  rejectedKey = null,
  ghost = null,
  onSelect = null,
  className = '',
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

    for (const operation of operations) {
      if (operation.type !== 'move') continue;
      const element = boardRef.current?.querySelector(`[data-square="${operation.to}"] .chess-board__piece`);
      if (!element?.animate) continue;
      const [fromColumn, fromRow] = screenCell(operation.from, orientation);
      const [toColumn, toRow] = screenCell(operation.to, orientation);
      element.animate(
        [
          // The piece is square-sized, so a whole percent is a whole square.
          { transform: `translate(${(fromColumn - toColumn) * 100}%, ${(fromRow - toRow) * 100}%)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: MOVE_DURATION_MS, easing: 'cubic-bezier(0.33, 0.9, 0.36, 1)' },
      );
    }
  }, [orientation, position]);

  const checkedKing = findCheckedKing(position, status);
  const destinationSet = useMemo(() => new Set(destinations), [destinations]);
  const candidateSet = useMemo(() => new Set(candidates), [candidates]);
  const hintSet = useMemo(() => new Set(hintTargets), [hintTargets]);

  const files = orientation === 'black' ? [...FILES].reverse() : [...FILES];
  const ranks = orientation === 'black' ? [...RANKS] : [...RANKS].reverse();

  // Labels are indexed by file/rank position, so a host hands over eight of each
  // and never has to know which way the board is currently facing.
  const fileLabel = (file) => fileLabels[FILES.indexOf(file)] ?? file;
  const rankLabel = (rank) => rankLabels[RANKS.indexOf(rank)] ?? rank;

  return (
    <div className={`chess-board-frame${className ? ` ${className}` : ''}`}>
      <div className="chess-board__rank-axis" aria-hidden="true">
        {ranks.map((rank) => (
          <span
            key={rank}
            className={`chess-board__axis-label${cursorSquare?.[1] === rank ? ' chess-board__axis-label--live' : ''}`}
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
            isRejected={rejectedSquare === square}
            ghostPiece={ghost?.square === square ? ghost.piece : null}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="chess-board__file-axis" aria-hidden="true">
        {files.map((file) => (
          <span
            key={file}
            className={`chess-board__axis-label${cursorSquare?.[0] === file ? ' chess-board__axis-label--live' : ''}`}
          >
            {fileLabel(file)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(ChessBoard);
