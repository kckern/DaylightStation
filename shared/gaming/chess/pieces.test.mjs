import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  PIECE_CODES, pieceAssetFilename, pieceAssetId, parsePieceCode,
  resolvePieceAsset, resolvePieceTheme, toPieceCode,
} from './pieces.mjs';

// Set when the private media tree is mounted, so the suite can prove the
// resolver's filenames match real artwork instead of only matching itself.
const ART_DIR = process.env.DAYLIGHT_BASE_PATH
  ? `${process.env.DAYLIGHT_BASE_PATH}/media/games/chess/svg`
  : null;

describe('chess piece assets', () => {
  it('covers twelve distinct pieces', () => {
    assert.equal(PIECE_CODES.length, 12);
    assert.equal(new Set(PIECE_CODES).size, 12);
  });

  it('parses and rebuilds piece codes', () => {
    assert.deepEqual(parsePieceCode('wP'), { color: 'w', type: 'p', name: 'pawn' });
    assert.equal(toPieceCode({ color: 'b', type: 'n' }), 'bN');
    for (const bad of ['wp', 'xP', 'w', '', null]) assert.equal(parsePieceCode(bad), null);
    assert.equal(toPieceCode({ color: 'g', type: 'p' }), null);
  });

  it('maps white to the light art and black to the dark art', () => {
    assert.equal(pieceAssetFilename('wP'), 'pawn_light_none.svg');
    assert.equal(pieceAssetFilename('bK'), 'king_dark_none.svg');
    assert.equal(pieceAssetFilename('bN', { background: 'light' }), 'knight_dark_light.svg');
    assert.equal(pieceAssetFilename('wQ', { rotated: true }), 'queen-rot_light_none.svg');
    assert.equal(pieceAssetFilename('wP', { background: 'sideways' }), null);
  });

  it('builds catalog ids', () => {
    assert.equal(pieceAssetId('wP'), 'chess.pawn-light');
    assert.equal(pieceAssetId('bR', { background: 'dark' }), 'chess.rook-dark-on-dark');
    assert.equal(pieceAssetId('bR', { rotated: true }), 'chess.rook-rot-dark');
  });

  it('resolves sources against a configurable base path', () => {
    assert.equal(resolvePieceAsset('wP'), '/media/games/chess/svg/pawn_light_none.svg');
    assert.equal(resolvePieceAsset('wP', { basePath: 'https://cdn.example/chess/' }), 'https://cdn.example/chess/pawn_light_none.svg');
    assert.equal(resolvePieceAsset('nope'), null);
    assert.equal(Object.keys(resolvePieceTheme()).length, 12);
  });

  it('names files that exist in the media tree', { skip: !ART_DIR || !existsSync(ART_DIR) ? 'private media tree not mounted' : false }, () => {
    for (const code of PIECE_CODES) {
      for (const background of ['none', 'light', 'dark']) {
        for (const rotated of [false, true]) {
          const file = `${ART_DIR}/${pieceAssetFilename(code, { background, rotated })}`;
          assert.ok(existsSync(file), `missing artwork: ${file}`);
        }
      }
    }
  });
});
