// A SET: the picture played inside a picture — a vintage TV in a living room.
//
// A definition's `set:` names a backdrop drawn behind everything, the rect on
// it where the screen is (fractions of the 16:9 picture), and an optional
// bezel drawn OVER the picture with the screen left transparent, so the set's
// glass, curve and corners sit on the video. The frame places its media box on
// the rect; the Player inside it is untouched (its CRT pass still decides by
// the source's own resolution).
//
// Refs are relative to the surround image tree (`media/img/surround/`),
// because a set belongs to a definition, not to any one corpus.
import { assetUrl } from './moduleKit.js';

const SET_ASSET_BASE = 'surround';

const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * @param {Object|null} definition - The surround definition
 * @returns {{ backdrop: string, bezel: string|null, screen: {x: number, y: number, w: number, h: number} }|null}
 *   null when there is no set or its screen does not lie inside the picture.
 */
export function resolveSet(definition) {
  const set = definition?.set;
  if (!set || typeof set !== 'object') return null;
  const s = set.screen;
  if (!s || ![s.x, s.y, s.w, s.h].every(isFraction) || s.w <= 0 || s.h <= 0) return null;
  if (s.x + s.w > 1 || s.y + s.h > 1) return null;
  const backdrop = assetUrl(SET_ASSET_BASE, set.backdrop);
  if (!backdrop) return null;
  return {
    backdrop,
    bezel: assetUrl(SET_ASSET_BASE, set.bezel),
    screen: { x: s.x, y: s.y, w: s.w, h: s.h },
  };
}
