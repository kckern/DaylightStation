import { useMemo } from 'react';
import { getPieceCells, BOARD_ROWS, BOARD_COLS, PIECES } from '../tetrisEngine.js';
import './TetrisBoard.scss';

const PIECE_COLORS = {
  I: 180, O: 50, T: 280, S: 120, Z: 0, J: 220, L: 30,
};

export function TetrisBoard({ board, currentPiece, ghostPiece, nextPiece }) {
  // Build display grid combining board + ghost + current piece
  const displayGrid = useMemo(() => {
    const grid = board.map(row => row.map(cell =>
      cell ? { ...cell, state: 'locked' } : null
    ));

    if (ghostPiece) {
      const ghostCells = getPieceCells(ghostPiece);
      for (const [r, c] of ghostCells) {
        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS && !grid[r][c]) {
          grid[r][c] = { type: ghostPiece.type, state: 'ghost' };
        }
      }
    }

    if (currentPiece) {
      const cells = getPieceCells(currentPiece);
      for (const [r, c] of cells) {
        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS) {
          grid[r][c] = { type: currentPiece.type, state: 'active' };
        }
      }
    }

    return grid;
  }, [board, currentPiece, ghostPiece]);

  // Next piece preview — 4x4 mini grid
  const nextPieceGrid = useMemo(() => {
    if (!nextPiece) return null;
    const type = typeof nextPiece === 'string' ? nextPiece : nextPiece.type;
    const offsets = PIECES[type]?.[0];
    if (!offsets) return null;
    const grid = Array.from({ length: 4 }, () => Array(4).fill(null));
    for (const [r, c] of offsets) {
      if (r >= 0 && r < 4 && c >= 0 && c < 4) {
        grid[r][c] = { type };
      }
    }
    return grid;
  }, [nextPiece]);

  return (
    <div className="tetris-board-wrapper">
      <div className="tetris-board">
        {displayGrid.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              className={`tetris-cell${cell ? ` tetris-cell--${cell.state}` : ''}`}
              style={cell ? { '--hue': PIECE_COLORS[cell.type] ?? 0 } : undefined}
            />
          ))
        )}
      </div>

      {nextPieceGrid && (
        <div className="tetris-next">
          <span className="tetris-next__label">NEXT</span>
          <div className="tetris-next__grid">
            {nextPieceGrid.map((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`next-${r}-${c}`}
                  className={`tetris-cell${cell ? ' tetris-cell--preview' : ''}`}
                  style={cell ? { '--hue': PIECE_COLORS[cell.type] ?? 0 } : undefined}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { PIECE_COLORS };
