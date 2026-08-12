import { memo, useMemo } from 'react';
import {
  CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, FILES, RANKS,
  fenToPosition, orderedSquares, squareColor, squareToChord,
} from '@shared-gaming/chess/index.mjs';
import { pieceSource } from './pieceAssets.js';
import './ChessBoard.scss';

/**
 * The board, shared by every surface that shows one.
 *
 * Two coordinate systems, one board. `notation="algebraic"` labels the rim a-h
 * and 1-8 for teaching and mouse play; `notation="chord"` labels it with the
 * chord that addresses each file and rank, which is what the piano kiosk needs
 * because there the player finds a square by playing it.
 *
 * Colour comes entirely from CSS custom properties, so a host restyles the board
 * by setting tokens rather than by overriding selectors.
 */

/** Major's chord symbol is the empty string; an axis needs something to print. */
function qualityLabel(quality) {
  return CHORD_QUALITIES[quality]?.label || 'maj';
}

/** The king in check, so the board can mark it. */
function findCheckedKing(position, status) {
  if (!status?.check) return null;
  const king = `${status.turn}K`;
  return Object.keys(position).find((square) => position[square] === king) ?? null;
}

function Square({
  square, piece, isLight, isSelected, isDestination, isLastMove,
  isCursor, isOnCursorLine, isCheck, isMarked, label, onSelect,
}) {
  const classes = [
    'chess-board__square',
    isLight ? 'chess-board__square--light' : 'chess-board__square--dark',
    isOnCursorLine && 'chess-board__square--cursor-line',
    isLastMove && 'chess-board__square--last-move',
    isMarked && 'chess-board__square--marked',
    isDestination && 'chess-board__square--destination',
    isSelected && 'chess-board__square--selected',
    isCursor && 'chess-board__square--cursor',
    isCheck && 'chess-board__square--check',
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
      {piece && (
        <img className="chess-board__piece" src={pieceSource(piece)} alt="" draggable="false" />
      )}
      {label && <span className="chess-board__square-label" aria-hidden="true">{label}</span>}
    </button>
  );
}

export function ChessBoard({
  fen,
  status = null,
  orientation = 'white',
  notation = 'algebraic',
  scheme = DEFAULT_CHORD_SCHEME,
  selected = null,
  destinations = [],
  lastMove = null,
  cursorSquare = null,
  markedSquares = [],
  onSelect = null,
  className = '',
}) {
  const position = useMemo(() => fenToPosition(fen) || {}, [fen]);
  const squares = useMemo(() => orderedSquares(orientation), [orientation]);
  const byChord = notation === 'chord';

  const squareLabels = useMemo(() => {
    if (!byChord) return {};
    return Object.fromEntries(squares.map((square) => [square, squareToChord(square, scheme)?.symbol]));
  }, [byChord, scheme, squares]);

  const checkedKing = findCheckedKing(position, status);
  const destinationSet = useMemo(() => new Set(destinations), [destinations]);
  const markedSet = useMemo(() => new Set(markedSquares), [markedSquares]);

  const files = orientation === 'black' ? [...FILES].reverse() : [...FILES];
  const ranks = orientation === 'black' ? [...RANKS] : [...RANKS].reverse();

  const fileLabel = (file) => (byChord ? scheme.roots[FILES.indexOf(file)] : file);
  const rankLabel = (rank) => (byChord ? qualityLabel(scheme.qualities[RANKS.indexOf(rank)]) : rank);

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

      <div className="chess-board" role="grid" aria-label="Chess board">
        {squares.map((square) => (
          <Square
            key={square}
            square={square}
            piece={position[square]}
            label={squareLabels[square]}
            isLight={squareColor(square) === 'light'}
            isSelected={selected === square}
            isDestination={destinationSet.has(square)}
            isMarked={markedSet.has(square)}
            isLastMove={lastMove?.from === square || lastMove?.to === square}
            isCursor={cursorSquare === square}
            isOnCursorLine={Boolean(cursorSquare) && (cursorSquare[0] === square[0] || cursorSquare[1] === square[1])}
            isCheck={checkedKing === square}
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
