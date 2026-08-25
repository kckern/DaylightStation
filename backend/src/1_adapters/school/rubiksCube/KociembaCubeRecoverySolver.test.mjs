import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, applySequence, createCube, isSolved } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { engineCubeToFacelets } from '#apps/school/rubiksCube/physicalCube.mjs';
import { KociembaCubeRecoverySolver } from './KociembaCubeRecoverySolver.mjs';

test('the bounded recovery worker returns moves independently verified by the cube engine', async () => {
  const cube = applyMove(createCube(), 'R');
  const solver = new KociembaCubeRecoverySolver({ timeoutMs: 30_000 });
  try {
    const moves = await solver.solve(engineCubeToFacelets(cube));
    assert.ok(moves.length > 0);
    assert.equal(isSolved(applySequence(cube, moves)), true);
  } finally { await solver.close(); }
});
