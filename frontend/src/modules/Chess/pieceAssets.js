import { parsePieceCode } from '@shared-gaming/chess/index.mjs';

import bishopDark from './pieces/bishop_dark_none.svg';
import bishopLight from './pieces/bishop_light_none.svg';
import kingDark from './pieces/king_dark_none.svg';
import kingLight from './pieces/king_light_none.svg';
import knightDark from './pieces/knight_dark_none.svg';
import knightLight from './pieces/knight_light_none.svg';
import pawnDark from './pieces/pawn_dark_none.svg';
import pawnLight from './pieces/pawn_light_none.svg';
import queenDark from './pieces/queen_dark_none.svg';
import queenLight from './pieces/queen_light_none.svg';
import rookDark from './pieces/rook_dark_none.svg';
import rookLight from './pieces/rook_light_none.svg';

import bishopRotDark from './pieces/bishop-rot_dark_none.svg';
import bishopRotLight from './pieces/bishop-rot_light_none.svg';
import kingRotDark from './pieces/king-rot_dark_none.svg';
import kingRotLight from './pieces/king-rot_light_none.svg';
import knightRotDark from './pieces/knight-rot_dark_none.svg';
import knightRotLight from './pieces/knight-rot_light_none.svg';
import pawnRotDark from './pieces/pawn-rot_dark_none.svg';
import pawnRotLight from './pieces/pawn-rot_light_none.svg';
import queenRotDark from './pieces/queen-rot_dark_none.svg';
import queenRotLight from './pieces/queen-rot_light_none.svg';
import rookRotDark from './pieces/rook-rot_dark_none.svg';
import rookRotLight from './pieces/rook-rot_light_none.svg';

/**
 * Piece artwork, bundled with the app rather than fetched from the media tree.
 *
 * The media route will not serve SVG as `image/svg+xml` — an SVG is
 * script-capable, so serving one from this origin would turn any file written
 * into the media tree into an XSS vector. It falls through to octet-stream with
 * `nosniff`, which an `<img>` refuses to render. These pieces are fixed app
 * chrome, not media, so importing them makes them build-time assets under our
 * control and drops the runtime dependency on the media mount.
 *
 * The full 72-variant set (light and dark background plates included) stays in
 * `media/games/chess/svg` with its manifest, for print and CLI use — that is
 * what `resolvePieceAsset` in shared addresses. Screens need only the
 * transparent set, because the board already supplies the square colour.
 *
 * Cburnett, CC BY-SA 3.0 / GFDL.
 */

const UPRIGHT = {
  pawn: { light: pawnLight, dark: pawnDark },
  knight: { light: knightLight, dark: knightDark },
  bishop: { light: bishopLight, dark: bishopDark },
  rook: { light: rookLight, dark: rookDark },
  queen: { light: queenLight, dark: queenDark },
  king: { light: kingLight, dark: kingDark },
};

const ROTATED = {
  pawn: { light: pawnRotLight, dark: pawnRotDark },
  knight: { light: knightRotLight, dark: knightRotDark },
  bishop: { light: bishopRotLight, dark: bishopRotDark },
  rook: { light: rookRotLight, dark: rookRotDark },
  queen: { light: queenRotLight, dark: queenRotDark },
  king: { light: kingRotLight, dark: kingRotDark },
};

/** 'wP' -> a bundled URL. Null for anything that is not a piece code. */
export function pieceSource(code, { rotated = false } = {}) {
  const piece = parsePieceCode(code);
  if (!piece) return null;
  const set = rotated ? ROTATED : UPRIGHT;
  return set[piece.name]?.[piece.color === 'w' ? 'light' : 'dark'] ?? null;
}
