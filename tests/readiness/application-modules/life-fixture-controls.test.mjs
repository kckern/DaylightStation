import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const runner = fs.readFileSync(new URL('./run-local-app.mjs', import.meta.url), 'utf8');
const literal = runner.match(/const reviewedArray = (\/.*\/).test\(relative\);/)[1];
const reviewedArray = new RegExp(literal.slice(1, -1));
test('Life array boundary admits only exact stored user metrics and ceremony record paths', () => {
  for (const name of ['data/users/member/lifeplan-metrics.yml', 'data/users/member-2/lifeplan-metrics.yml', 'data/users/member/ceremony-records.yml']) assert.ok(reviewedArray.test(name), name);
  for (const name of ['data/users/member/lifeplan-metrics.yaml', 'data/users/member/lifeplan.yml',
    'data/users/member/ceremony-records.yaml', 'data/users/member/lifelog/strava.yml',
    'data/users/member/lifeplan-metrics/nested.yml', 'data/users/member/ceremony-records/nested.yml', 'data/users/../lifeplan-metrics.yml',
    'data/users/member/../lifeplan-metrics.yml', 'data/household/lifeplan-metrics.yml',
    'data/system/config/lifeplan-metrics.yml', '/data/users/member/lifeplan-metrics.yml',
    'media/users/member/lifeplan-metrics.yml']) assert.equal(reviewedArray.test(name), false, name);
});
