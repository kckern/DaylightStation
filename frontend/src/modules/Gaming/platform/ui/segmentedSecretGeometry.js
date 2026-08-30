export const SEGMENTS = Object.freeze({
  a1: [7, 6, 23, 6], a2: [27, 6, 43, 6], b: [44, 10, 44, 44], c: [44, 56, 44, 90],
  d1: [7, 94, 23, 94], d2: [27, 94, 43, 94], e: [6, 56, 6, 90], f: [6, 10, 6, 44],
  g1: [9, 50, 23, 50], g2: [27, 50, 41, 50], h: [10, 10, 22, 44], i: [40, 10, 28, 44],
  j: [22, 56, 10, 90], k: [28, 56, 40, 90], l: [25, 10, 25, 44], m: [25, 56, 25, 90],
});

const GLYPHS = Object.freeze({
  A: 'a b c e f g1 g2', B: 'c d e f g1 g2 l m', C: 'a d e f', D: 'a b c d e f', E: 'a d e f g1 g2', F: 'a e f g1 g2',
  G: 'a c d e f g2', H: 'b c e f g1 g2', I: 'a d l m', J: 'b c d e', K: 'e f g1 h i k', L: 'd e f', M: 'b c e f h i',
  N: 'b c e f h k', O: 'a b c d e f', P: 'a b e f g1 g2', Q: 'a b c d e f k', R: 'a b e f g1 g2 k', S: 'a c d f g1 g2',
  T: 'a l m', U: 'b c d e f', V: 'e f j k', W: 'b c e f j m', X: 'h i j k', Y: 'h i m', Z: 'a d i j',
  0: 'a b c d e f', 1: 'b c', 2: 'a b d e g1 g2', 3: 'a b c d g1 g2', 4: 'b c f g1 g2', 5: 'a c d f g1 g2',
  6: 'a c d e f g1 g2', 7: 'a b c', 8: 'a b c d e f g1 g2', 9: 'a b c d f g1 g2', '-': 'g1 g2', '?': 'a b g2 m',
});

export const segmentNames = Object.keys(SEGMENTS);

export function activeSegmentsFor(character) {
  const logical = (GLYPHS[String(character || '').toUpperCase()] || '').split(' ').filter(Boolean);
  return logical.flatMap((name) => name === 'a' ? ['a1', 'a2'] : name === 'd' ? ['d1', 'd2'] : [name]);
}

export function segmentPoints([x1, y1, x2, y2]) {
  const dx = x2 - x1; const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length; const uy = dy / length;
  const px = -uy * 3; const py = ux * 3;
  const taper = Math.min(3, length / 4);
  return [
    [x1, y1], [x1 + ux * taper + px, y1 + uy * taper + py],
    [x2 - ux * taper + px, y2 - uy * taper + py], [x2, y2],
    [x2 - ux * taper - px, y2 - uy * taper - py], [x1 + ux * taper - px, y1 + uy * taper - py],
  ].map((point) => point.join(',')).join(' ');
}
