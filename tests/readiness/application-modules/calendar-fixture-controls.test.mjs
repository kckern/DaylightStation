import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DataServiceCalendarEventSource } from '../../../modules/calendar/server/adapters/DataServiceCalendarEventSource.mjs';

// Inspect the runner's actual array boundary without importing its boot entrypoint.
const runner = fs.readFileSync(new URL('./run-local-app.mjs', import.meta.url), 'utf8');
const literal = runner.match(/const reviewedArray = (\/.*\/).test\(relative\);/)[1];
const reviewedArray = new RegExp(literal.slice(1, -1));
test('Calendar array roots remain limited to stored current and legacy event paths', () => {
  for (const name of ['data/household/calendar/calendar.yml', 'data/household-h1/calendar/calendar.yaml',
    'data/household/apps/calendar.yml', 'data/household-h1/apps/calendar.yaml',
    'data/household/finance/transaction.pairs.yml', 'data/household/gratitude/selections.gratitude.yml']) {
    assert.ok(reviewedArray.test(name), name);
  }
  for (const name of ['data/system/config/auth.yml', 'data/household/hardware/devices.yml',
    'data/household/calendar/events.yml', 'data/household/calendar/calendar/nested.yml',
    'data/household/apps/calendar/config.yml', 'data/household/apps/other.yml',
    'data/household-../calendar/calendar.yml', 'data/household/../calendar/calendar.yml',
    '/data/household/calendar/calendar.yml', 'media/household/calendar/calendar.yml']) {
    assert.equal(reviewedArray.test(name), false, name);
  }
});
test('current Calendar array, including empty, prevents legacy fallback reads', () => {
  for (const events of [[], [{ id: 'primary-event', start: { date: '2026-03-04' } }]]) {
    const calls = [];
    const source = new DataServiceCalendarEventSource({ dataService: { household: { read(key, hid) {
      calls.push([key, hid]); assert.equal(key, 'calendar/calendar'); return events;
    } } } });
    assert.strictEqual(source.readEvents('h1'), events);
    assert.deepEqual(calls, [['calendar/calendar', 'h1']]);
  }
});
test('missing or mapping current backing uses populated legacy event array', () => {
  for (const primary of [null, {}]) {
    const legacy = [{ id: 'legacy-event', start: { dateTime: '2026-02-01T10:00:00-08:00' } }];
    const calls = [];
    const source = new DataServiceCalendarEventSource({ dataService: { household: { read(key, hid) {
      calls.push([key, hid]); return key === 'calendar/calendar' ? primary : legacy;
    } } } });
    assert.strictEqual(source.readEvents('h1'), legacy);
    assert.deepEqual(calls, [['calendar/calendar', 'h1'], ['apps/calendar', 'h1']]);
  }
});

test('invalid fixture timezone rejects before launcher or transport construction', () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const sourceRoot = path.resolve(directory, '../../..');
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-timezone-control-'));
  const fixed = JSON.parse(fs.readFileSync(path.join(directory, 'local-app-fixture.json')));
  for (const timezone of [null, 3, 'UTC\nNODE_OPTIONS=bad', '../UTC', 'Not/A_Timezone']) {
    const fixture = structuredClone(fixed);
    fixture.fixtureFiles['data/system/config/system.yml'].timezone = timezone;
    const file = path.join(outputRoot, 'fixture.json');
    fs.writeFileSync(file, JSON.stringify(fixture));
    const result = spawnSync(process.execPath, [path.join(directory, 'run-local-app.mjs'),
      '--source-root', sourceRoot, '--tool-root', sourceRoot, '--output-root', outputRoot,
      '--fixture', file, '--controls-only'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture timezone required|Invalid time zone specified/);
    assert.deepEqual(fs.readdirSync(outputRoot), ['fixture.json']);
  }
});
