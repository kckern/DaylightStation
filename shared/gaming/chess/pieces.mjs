/**
 * Piece code -> artwork, kept as a resolver rather than a table of URLs.
 *
 * Follows chessboard.js's `pieceTheme` idea: callers hand in a base path and get
 * back a resolved source, so the same board renders from private media, a CDN, or
 * an inlined test double without the view knowing which.
 *
 * Backing art is the Cburnett SVG set (CC BY-SA 3.0 / GFDL) at
 * `media/games/chess/svg`, stored under descriptive names because the upstream
 * wiki codes (`Chess_bdt45` vs `Chess_Bdt45`) collide on case-insensitive
 * filesystems. `manifest.json` beside the art maps each file to its wiki code.
 *
 * NOT the path the browser board uses. The media route refuses to serve SVG as
 * `image/svg+xml` on purpose — an SVG is script-capable, so serving one from the
 * app origin would make any file written into the media tree an XSS vector — and
 * the octet-stream fallback will not render in an `<img>`. The frontend bundles
 * its own copy (`frontend/src/modules/Chess/pieceAssets.js`). These resolvers are
 * for print, CLI, and anything reading the media tree directly.
 */

export const PIECE_NAMES = Object.freeze({
  P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
});

/** White is the 'light' art, black the 'dark' art. */
export const COLOR_VARIANTS = Object.freeze({ w: 'light', b: 'dark' });

/** Third-letter variants of the source set: transparent, light plate, dark plate. */
export const BACKGROUNDS = Object.freeze(['none', 'light', 'dark']);

export const PIECE_CODES = Object.freeze(
  ['w', 'b'].flatMap((color) => Object.keys(PIECE_NAMES).map((type) => `${color}${type}`)),
);

const PIECE_CODE_RE = /^[wb][PNBRQK]$/;

export function isPieceCode(value) {
  return typeof value === 'string' && PIECE_CODE_RE.test(value);
}

/** 'wP' -> { color: 'w', type: 'p', name: 'pawn' }. */
export function parsePieceCode(code) {
  if (!isPieceCode(code)) return null;
  return { color: code[0], type: code[1].toLowerCase(), name: PIECE_NAMES[code[1]] };
}

/** chess.js `{ color, type }` -> 'wP'. */
export function toPieceCode(piece) {
  const color = piece?.color;
  const type = String(piece?.type || '').toUpperCase();
  if (!['w', 'b'].includes(color) || !PIECE_NAMES[type]) return null;
  return `${color}${type}`;
}

/**
 * Filename for one piece.
 *
 * `rotated` selects the upside-down glyphs, which exist so a board shared across
 * a table reads right way up from both sides — the physical-board case a screen
 * flip cannot cover.
 */
export function pieceAssetFilename(code, { background = 'none', rotated = false } = {}) {
  const piece = parsePieceCode(code);
  if (!piece || !BACKGROUNDS.includes(background)) return null;
  return `${piece.name}${rotated ? '-rot' : ''}_${COLOR_VARIANTS[piece.color]}_${background}.svg`;
}

/** Stable semantic id for the gaming asset catalog, e.g. 'chess.pawn-light'. */
export function pieceAssetId(code, { background = 'none', rotated = false } = {}) {
  const piece = parsePieceCode(code);
  if (!piece || !BACKGROUNDS.includes(background)) return null;
  const suffix = background === 'none' ? '' : `-on-${background}`;
  return `chess.${piece.name}${rotated ? '-rot' : ''}-${COLOR_VARIANTS[piece.color]}${suffix}`;
}

/** Resolves one piece to a loadable source. `basePath` may be a URL or a route. */
export function resolvePieceAsset(code, { basePath = '/media/games/chess/svg', background = 'none', rotated = false } = {}) {
  const filename = pieceAssetFilename(code, { background, rotated });
  if (!filename) return null;
  return `${String(basePath).replace(/\/+$/, '')}/${filename}`;
}

/** Every piece resolved at once — handy for preloading before a board paints. */
export function resolvePieceTheme(options = {}) {
  return Object.fromEntries(PIECE_CODES.map((code) => [code, resolvePieceAsset(code, options)]));
}
