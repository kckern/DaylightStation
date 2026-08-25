import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, createCube } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { engineCubeToFacelets, parsePhysicalCube } from './physicalCube.mjs';

const color = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
const facesFor = (cube) => {
  const flat = engineCubeToFacelets(cube);
  return Object.fromEntries(['U', 'R', 'F', 'D', 'L', 'B'].map((face, index) => [face, [...flat.slice(index * 9, index * 9 + 9)].map((role) => color[role])]));
};

test('physical touch input accepts a legal cube and maps it to the engine', () => {
  const parsed = parsePhysicalCube(facesFor(applyMove(createCube(), 'R')));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.facelets.length, 54);
});

test('physical touch input rejects a single flipped edge as impossible', () => {
  const faces = facesFor(createCube());
  [faces.U[7], faces.F[1]] = [faces.F[1], faces.U[7]];
  const parsed = parsePhysicalCube(faces);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].code, 'EDGE_FLIP');
});
