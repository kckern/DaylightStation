/**
 * Chess core: rules, render projection, and artwork.
 *
 * Squares and moves, nothing else. It knows no input device or host-specific
 * interaction language; those live with whatever is driving the board.
 *
 * The RuleModule below owns authoritative chess transitions. Native contexts
 * retain their addressing and teaching projections without a second reducer.
 *
 * Exports are explicit because `isPieceCode` has a home in both `pieces` (where
 * it guards artwork lookups) and `position` (where it guards the board map);
 * a star re-export would drop the name silently.
 */

export {
  INITIAL_FEN,
  applyMove,
  attackersOf,
  createGame,
  describeGame,
  describePosition,
  gameFromPgn,
  gameToPgn,
  isPromotion,
  isValidFen,
  legalDestinations,
  legalMoves,
  playMove,
  undoMove,
} from './engine.mjs';

export {
  FILES,
  RANKS,
  SQUARES,
  countMaterial,
  diffPositions,
  fenToPosition,
  isSquare,
  orderedSquares,
  positionToFen,
  squareColor,
  squareDistance,
} from './position.mjs';

export {
  BACKGROUNDS,
  COLOR_VARIANTS,
  PIECE_CODES,
  PIECE_NAMES,
  isPieceCode,
  parsePieceCode,
  pieceAssetFilename,
  pieceAssetId,
  resolvePieceAsset,
  resolvePieceTheme,
  toPieceCode,
} from './pieces.mjs';

export { chessDefinition, chessRuleModule, validateChessDefinition } from './ruleModule.mjs';
