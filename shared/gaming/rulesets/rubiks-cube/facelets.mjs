import { COLORS, FACES, createCube, isValidCube } from './index.mjs';

export const CUBE_FACELETS = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);

export function faceletsToEngineCube(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return null;
  const cube = createCube();
  CUBE_FACELETS.forEach((face, faceIndex) => {
    cube[face] = [...facelets.slice(faceIndex * 9, faceIndex * 9 + 9)].map((role) => COLORS[role]);
  });
  return isValidCube(cube) ? cube : null;
}

export function engineCubeToFacelets(cube) {
  if (!isValidCube(cube)) return null;
  const roleForColor = new Map(Object.entries(COLORS).map(([face, color]) => [color, face]));
  return CUBE_FACELETS.flatMap((face) => cube[face].map((color) => roleForColor.get(color))).join('');
}
