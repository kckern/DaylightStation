/**
 * A small, dependency-free 3×3 cube model.  Stickers are stored by their
 * physical position and normal, so a face turn is one geometric operation,
 * not six subtly different strip swaps.
 */
export const FACES = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);
export const COLORS = Object.freeze({ U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' });

const key = (p, n) => `${p.join(',')}|${n.join(',')}`;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const OPPOSITE_FACE = Object.freeze({ U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' });

function facelet(face, row, col) {
  const a = col - 1; const b = 1 - row;
  if (face === 'U') return { p: [a, 1, -b], n: [0, 1, 0] };
  if (face === 'D') return { p: [a, -1, b], n: [0, -1, 0] };
  if (face === 'F') return { p: [a, b, 1], n: [0, 0, 1] };
  if (face === 'B') return { p: [-a, b, -1], n: [0, 0, -1] };
  if (face === 'R') return { p: [1, b, -a], n: [1, 0, 0] };
  return { p: [-1, b, a], n: [-1, 0, 0] };
}

const FACELETS = Object.freeze(FACES.flatMap((face) => Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3); const col = i % 3; const geometry = facelet(face, row, col);
  return { face, row, col, ...geometry, key: key(geometry.p, geometry.n) };
})));
const LOOKUP = new Map(FACELETS.map((item) => [item.key, item]));
const NORMALS = Object.freeze({ U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] });

function rotate(vector, axis, quarterTurns) {
  let next = [...vector];
  const steps = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < steps; i += 1) {
    const [x, y, z] = next; const [ax, ay, az] = axis;
    // Right-hand +90° around one of the six cardinal axes.
    if (ax) next = [x, ax > 0 ? -z : z, ax > 0 ? y : -y];
    else if (ay) next = [ay > 0 ? z : -z, y, ay > 0 ? -x : x];
    else next = [az > 0 ? -y : y, az > 0 ? x : -x, z];
  }
  return next;
}

export function createCube() {
  return Object.fromEntries(FACES.map((face) => [face, Array(9).fill(COLORS[face])]));
}

export function cloneCube(cube) {
  return Object.fromEntries(FACES.map((face) => [face, [...(cube?.[face] || [])]]));
}

export function isValidCube(cube) {
  if (!cube || typeof cube !== 'object') return false;
  const stickers = FACES.flatMap((face) => cube[face] || []);
  if (stickers.length !== 54 || FACES.some((face) => !Array.isArray(cube[face]) || cube[face].length !== 9)) return false;
  return Object.values(COLORS).every((color) => stickers.filter((value) => value === color).length === 9)
    && FACES.every((face) => cube[face][4] === COLORS[face]);
}

export function normalizeMove(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toUpperCase();
  const match = /^([URFDLB])([2']?)$/.exec(value);
  return match ? `${match[1]}${match[2]}` : null;
}

export function inverseMove(move) {
  const normalized = normalizeMove(move); if (!normalized) return null;
  return normalized.endsWith('2') ? normalized : normalized.endsWith("'") ? normalized[0] : `${normalized}'`;
}

export function applyMove(cube, input) {
  const move = normalizeMove(input);
  if (!move || !isValidCube(cube)) return null;
  const face = move[0]; const axis = NORMALS[face];
  // Clockwise when looking directly at the named face is -90° around its
  // outward normal.  Half turns are direction-independent.
  const turns = move.endsWith('2') ? 2 : move.endsWith("'") ? 1 : -1;
  const next = cloneCube(cube);
  for (const source of FACELETS) {
    if (dot(source.p, axis) !== 1) continue;
    const destination = LOOKUP.get(key(rotate(source.p, axis, turns), rotate(source.n, axis, turns)));
    next[destination.face][destination.row * 3 + destination.col] = cube[source.face][source.row * 3 + source.col];
  }
  return next;
}

export function applySequence(cube, moves = []) {
  let next = cloneCube(cube);
  for (const move of moves) { next = applyMove(next, move); if (!next) return null; }
  return next;
}

export function isSolved(cube) {
  return isValidCube(cube) && FACES.every((face) => cube[face].every((sticker) => sticker === COLORS[face]));
}

export function cubeFaces(cube) {
  if (!isValidCube(cube)) return null;
  return Object.fromEntries(FACES.map((face) => [face, [...cube[face]]]));
}

/** Deterministic, non-trivial practice scramble. */
export function scramble(seed = 1, length = 20) {
  let value = Number(seed) >>> 0; const random = () => { value = (1664525 * value + 1013904223) >>> 0; return value / 0x100000000; };
  const moves = []; let previous = null;
  while (moves.length < length) {
    const face = FACES[Math.floor(random() * FACES.length)];
    if (face === previous || face === OPPOSITE_FACE[previous]) continue;
    const suffix = ['', "'", '2'][Math.floor(random() * 3)]; moves.push(`${face}${suffix}`); previous = face;
  }
  return moves;
}
