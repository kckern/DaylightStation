import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const runner = fs.readFileSync(new URL('./run-local-app.mjs', import.meta.url), 'utf8');
const literal = runner.match(/const reviewedArray = (\/.*\/).test\(relative\);/)[1];
const reviewedArray = new RegExp(literal.slice(1, -1));
test('Health array boundary admits only reviewed user catalog and hot observation files', () => {
  for (const name of ['data/users/member/lifelog/nutrition/food_catalog.yml',
    'data/users/member-2/lifelog/nutrition/observations.yaml']) assert.ok(reviewedArray.test(name), name);
  for (const name of ['data/users/member/apps/health/meals.yml',
    'data/users/member/lifelog/nutrition/nutrilist.yml', 'data/users/member/lifelog/nutrition/ledger-operations.yml',
    'data/users/member/lifelog/nutrition/archives/observations/2026-09.yml',
    'data/users/member/lifelog/nutrition/food_catalog/nested.yml',
    'data/users/member/auth.yml', 'data/system/config/auth.yml',
    'data/users/../lifelog/nutrition/observations.yml',
    'data/users/member/../lifelog/nutrition/observations.yml',
    'data/household/lifelog/nutrition/food_catalog.yml', '/data/users/member/lifelog/nutrition/food_catalog.yml',
    'media/users/member/lifelog/nutrition/observations.yml']) assert.equal(reviewedArray.test(name), false, name);
});
