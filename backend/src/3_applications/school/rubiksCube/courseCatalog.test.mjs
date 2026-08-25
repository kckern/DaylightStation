import assert from 'node:assert/strict';
import test from 'node:test';
import { RUBIKS_CUBE_COURSE, RUBIKS_CUBE_REVISION, activities, publicActivity } from './courseCatalog.mjs';

test('the YAML catalogue hydrates staged practice and hides answer material', () => {
  assert.equal(RUBIKS_CUBE_REVISION, 3);
  assert.equal(RUBIKS_CUBE_COURSE.units.length, 7);
  const cross = activities().find((activity) => activity.id === 'cross-edges');
  assert.equal(cross.goal, 'white-cross');
  assert.ok(cross.solution.length > 0);
  assert.equal(publicActivity(cross).solution, undefined);
  const check = activities().find((activity) => activity.id === 'yellow-face-quiz');
  assert.equal(check.questions.length, 5);
  assert.equal(publicActivity(check).questions[0].answer, undefined);
});
