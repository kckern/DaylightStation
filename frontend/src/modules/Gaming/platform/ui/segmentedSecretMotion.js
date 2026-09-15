import { seededRandom } from './imageDecoderArtifacts.js';

export const SECRET_TEXT_MOTION_MS = 1000;
// Offsets are percentages of the card's own box. The text card is nearly the
// full stage width (`min(96vw, 90rem)`), so the image decoder's ±35% would
// throw it off the TV; ±2% stays inside the card's 2vw side margin while still
// jumping most of a glyph width on every frame.
export const SECRET_TEXT_MOTION_X = 2;
export const SECRET_TEXT_MOTION_Y = 10;

/**
 * Where the text card sits on each tick, following `generateDecoderMotion`:
 * alternating horizontal edges guarantee a jump every frame, so a viewer who
 * stares and squints never gets a steady image to integrate, and a seeded
 * vertical shift keeps the path from being learned. Seeded by the clue, so the
 * same clue always moves the same way and a new clue starts a new path.
 */
export function generateSecretTextMotion(seed, count = 8) {
  const random = seededRandom(`${seed}:secret-text-motion`);
  const startAtFarEdge = random() >= 0.5;
  return Array.from({ length: Math.max(2, count) }, (_, index) => ({
    id: index,
    x: (Boolean(index % 2) !== startAtFarEdge ? 1 : -1) * SECRET_TEXT_MOTION_X,
    y: -SECRET_TEXT_MOTION_Y + random() * SECRET_TEXT_MOTION_Y * 2,
  }));
}
