import Cube from 'cubejs';
import { COLORS, FACES, createCube, isValidCube } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';

const FACELETS = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);
const CORNERS = Object.freeze(['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB']);
const EDGES = Object.freeze(['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR']);

const normalized = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const setKey = (values) => [...values].sort().join('');
const issue = (code, message, details = {}) => ({ code, message, ...details });

function faceletString(faces) {
  return FACELETS.flatMap((face) => faces[face] || []).join('');
}

function verifyCubies(facelets) {
  const cube = Cube.fromString(facelets);
  const actualCorners = CORNERS.map((_, index) => {
    const offsets = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]][index];
    return setKey(offsets.map((offset) => facelets[offset]));
  });
  const actualEdges = EDGES.map((_, index) => {
    const offsets = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]][index];
    return setKey(offsets.map((offset) => facelets[offset]));
  });
  const expectedCorners = new Set(CORNERS.map((value) => setKey(value)));
  const expectedEdges = new Set(EDGES.map((value) => setKey(value)));
  if (new Set(actualCorners).size !== 8 || actualCorners.some((value) => !expectedCorners.has(value))) {
    return { ok: false, errors: [issue('CORNER_INVENTORY', 'One or more corner pieces were entered incorrectly. Recheck the three stickers around each corner.')] };
  }
  if (new Set(actualEdges).size !== 12 || actualEdges.some((value) => !expectedEdges.has(value))) {
    return { ok: false, errors: [issue('EDGE_INVENTORY', 'One or more edge pieces were entered incorrectly. Recheck the two stickers on each edge.')] };
  }
  if (cube.co.reduce((sum, value) => sum + value, 0) % 3 !== 0) {
    return { ok: false, errors: [issue('CORNER_TWIST', 'This would twist one corner by itself. Recheck the corners you entered.')] };
  }
  if (cube.eo.reduce((sum, value) => sum + value, 0) % 2 !== 0) {
    return { ok: false, errors: [issue('EDGE_FLIP', 'This would flip one edge by itself. Recheck the edge stickers you entered.')] };
  }
  if (cube.cornerParity() !== cube.edgeParity()) {
    return { ok: false, errors: [issue('PARITY', 'This configuration swaps only two pieces. Recheck the entry; if it is correct, ask a grown-up because the cube may have been reassembled.')] };
  }
  return { ok: true, cube };
}

/**
 * Turn the six faces painted in the touch wizard into the fixed URFDLB solver
 * alphabet. Values may be ordinary colour names or any six distinct labels;
 * centers define their roles so a non-standard sticker scheme still works.
 */
export function parsePhysicalCube(rawFaces) {
  if (!rawFaces || typeof rawFaces !== 'object') return { ok: false, errors: [issue('FACES_REQUIRED', 'Enter all six faces of the cube.')] };
  const entered = Object.fromEntries(FACELETS.map((face) => [face, Array.isArray(rawFaces[face]) ? rawFaces[face].map(normalized) : []]));
  if (FACELETS.some((face) => entered[face].length !== 9 || entered[face].some((sticker) => !sticker))) {
    return { ok: false, errors: [issue('INCOMPLETE', 'Each face needs nine stickers before the cube can be checked.')] };
  }
  const centers = Object.fromEntries(FACELETS.map((face) => [face, entered[face][4]]));
  if (new Set(Object.values(centers)).size !== 6) {
    return { ok: false, errors: [issue('CENTERS', 'Each center must be a different colour. Recheck which face is facing you.')] };
  }
  const roleForColor = new Map(Object.entries(centers).map(([face, color]) => [color, face]));
  const unknown = FACELETS.flatMap((face) => entered[face]).find((color) => !roleForColor.has(color));
  if (unknown) return { ok: false, errors: [issue('UNKNOWN_COLOR', `“${unknown}” does not match any center. Recheck that sticker.`)] };
  const facelets = faceletString(Object.fromEntries(FACELETS.map((face) => [face, entered[face].map((color) => roleForColor.get(color))])));
  if (FACELETS.some((role) => [...facelets].filter((value) => value === role).length !== 9)) {
    return { ok: false, errors: [issue('COLOR_COUNT', 'A real 3×3 has nine stickers of each center colour. Recheck the face counts.')] };
  }
  const checked = verifyCubies(facelets);
  if (!checked.ok) return checked;
  const cube = faceletsToEngineCube(facelets);
  return { ok: true, facelets, cube, centers, entered };
}

export function faceletsToEngineCube(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return null;
  const cube = createCube();
  FACELETS.forEach((face, faceIndex) => {
    cube[face] = [...facelets.slice(faceIndex * 9, faceIndex * 9 + 9)].map((role) => COLORS[role]);
  });
  return isValidCube(cube) ? cube : null;
}

export function engineCubeToFacelets(cube) {
  if (!isValidCube(cube)) return null;
  const roleForColor = new Map(Object.entries(COLORS).map(([face, color]) => [color, face]));
  return FACELETS.flatMap((face) => cube[face].map((color) => roleForColor.get(color))).join('');
}

export default { parsePhysicalCube, faceletsToEngineCube, engineCubeToFacelets };
