import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { validateRawFixtures } from './raw-utf8-fixture.mjs';

const runner = fs.readFileSync(new URL('./run-local-app.mjs', import.meta.url), 'utf8');
const admission = runner.slice(runner.indexOf('assert.ok(prepared.fixtureFiles &&'), runner.indexOf('// Explicit runtime timezone'));
const check = (relative, value) => vm.runInNewContext(admission, { assert, path, prepared: { fixtureFiles: { [relative]: value } } });
const calendar = 'data/users/user_1/current/calendar.yml';

test('Calendar JSON array admission is limited to the exact reviewed stored destination', () => {
  check(calendar, [{ id: 'synthetic-calendar', startDateTime: '2099-01-01T09:00:00-08:00' }]);
  for (const value of [null, 'scalar', 1, false]) assert.throws(() => check(calendar, value));
  for (const relative of [
    'data/users/user_2/current/calendar.yml', 'data/users/user_1/current/calendar.yaml',
    'data/users/user_1/current/calendars.yml', 'data/users/user_1/calendar.yml',
    'data/household/current/calendar.yml', 'data/content/current/calendar.yml',
    'data/users/user_1/current/todoist.yml', 'data/users/user_1/current/../calendar.yml',
    '/data/users/user_1/current/calendar.yml',
  ]) assert.throws(() => check(relative, []));
});

test('Calendar array admission preserves reviewed arrays and ordinary objects without granting raw bytes', () => {
  for (const relative of [
    'data/household/calendar/calendar.yml', 'data/household/apps/calendar.yml',
    'data/users/user_1/lifelog/nutrition/food_catalog.yml', 'data/users/user_1/ceremony-records.yml',
    'data/content/school/generated-banks/recipes.yml', 'data/users/user_1/apps/health/meals.yml',
    'data/household/automotive/synthetic-array-car/service.yml',
    'data/household/automotive/synthetic-array-car/documents.yml',
  ]) check(relative, []);
  for (const relative of [calendar, 'data/users/user_2/current/calendar.yml', 'data/users/user_1/current/todoist.yml']) check(relative, { entries: [] });
  const bytes = Buffer.from('[]\n');
  assert.throws(() => validateRawFixtures({ fixtureFiles: {}, rawUTF8Files: [{
    destination: calendar, encoding: 'utf8', base64: bytes.toString('base64'), byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }] }));
});
