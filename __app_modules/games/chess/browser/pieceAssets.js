import { parsePieceCode } from "../../../../__capabilities/gaming/portable/rulesets/chess/index.mjs";

/**
 * Piece artwork, served from the media volume at `/vendor/chess/pieces/`.
 *
 * The 24 transparent Cburnett SVGs are third-party artwork and are NOT in the
 * repo: `npm run install:assets` installs them (assets.manifest.yml,
 * `chess-piece-*`). The /vendor route serves them as static files, so a plain
 * `<img src>` renders them. A missing file is a broken image, not a build error.
 *
 * The full 72-variant set (light and dark background plates included) stays in
 * `media/games/chess/svg` with its manifest, for print and CLI use — that is
 * what `resolvePieceAsset` in shared addresses. Screens need only the
 * transparent set, because the board already supplies the square colour.
 *
 * Cburnett, CC BY-SA 3.0 / GFDL.
 */

const BASE = '/vendor/chess/pieces';
const url = (name, rot, side) => `${BASE}/${name}${rot ? '-rot' : ''}_${side}_none.svg`;
const set = (rot) => Object.fromEntries(
  ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].map((n) => [n, { light: url(n, rot, 'light'), dark: url(n, rot, 'dark') }]),
);

const UPRIGHT = set(false);
const ROTATED = set(true);

/** 'wP' -> a /vendor URL. Null for anything that is not a piece code. */
export function pieceSource(code, { rotated = false } = {}) {
  const piece = parsePieceCode(code);
  if (!piece) return null;
  const pieces = rotated ? ROTATED : UPRIGHT;
  return pieces[piece.name]?.[piece.color === 'w' ? 'light' : 'dark'] ?? null;
}
