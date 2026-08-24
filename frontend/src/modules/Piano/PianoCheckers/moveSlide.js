// moveSlide.js — where a piece has to come FROM, for the move that just landed.
//
// Pieces used to appear at their destination. That told the player nothing about
// the one thing a board game is: something moved, and which thing moved is the
// whole information. It matters most for the OPPONENT's move, which the player
// did not make and therefore has to read off the board.
//
// The offset is counted in CELLS, not pixels, so it holds at any board size —
// the same approach as Connect Four's drop (`--c4-drop-rows`). A piece is 72% of
// its cell, so one cell is 100/72 ≈ 138.9% of the piece's own width; the
// stylesheet does that conversion once.

import { indexToCoord } from '../../../../../shared/gaming/rulesets/checkers/engine.mjs';

/**
 * Cell offset from a move's destination back to its origin — i.e. where the
 * piece should START its slide, expressed relative to where it now sits.
 *
 * @param {{from: number, to: number}|null|undefined} move
 * @returns {{dx: number, dy: number}|null} null when there is nothing to animate
 */
export function slideOffsetCells(move) {
  if (!move) return null;
  const from = indexToCoord(move.from);
  const to = indexToCoord(move.to);
  if (!from || !to) return null;
  const dx = from.column - to.column;
  const dy = from.row - to.row;
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

/**
 * How long the slide should take. A jump crosses two cells and should read as
 * covering more ground, not as the same beat played faster.
 */
export function slideDurationMs(offset) {
  if (!offset) return 0;
  const cells = Math.max(Math.abs(offset.dx), Math.abs(offset.dy));
  return cells >= 2 ? 320 : 220;
}

export default slideOffsetCells;
