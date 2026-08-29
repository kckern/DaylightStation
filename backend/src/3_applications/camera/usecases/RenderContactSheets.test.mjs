import assert from 'node:assert/strict';
import test from 'node:test';
import { renderContactSheets } from './RenderContactSheets.mjs';

test('renders through the contact-sheet artifact port and returns its public name', async () => {
  const calls = { prepare: [], target: [], encode: [], metadata: [] };
  const sheetArtifacts = {
    async prepare(collection) { calls.prepare.push(collection); },
    target(collection, name) {
      calls.target.push({ collection, name });
      return { locator: `artifact://${name}`, name: `${name}.jpg` };
    },
  };
  const encoder = {
    async encodeContactSheet(request) { calls.encode.push(request); return true; },
    async writeSheetMetadata(request) { calls.metadata.push(request); },
  };
  const entry = {
    kind: 'event',
    start: new Date('2026-08-15T10:00:00Z'),
    end: new Date('2026-08-15T10:10:00Z'),
    labels: ['person'],
  };

  const result = await renderContactSheets({
    segments: [{
      start: new Date('2026-08-15T09:00:00Z'),
      end: new Date('2026-08-15T11:00:00Z'),
      path: 'segment-one',
    }],
    plan: [entry],
    camera: 'front-door',
    outDir: 'day-sheets',
    encoder,
    profile: { grid: '2x2', frames: 4, sourceFps: 10 },
    sheetArtifacts,
    logger: {},
  });

  assert.deepEqual(calls.prepare, ['day-sheets']);
  assert.equal(calls.target.length, 1);
  assert.equal(calls.target[0].collection, 'day-sheets');
  assert.match(calls.target[0].name, /-person$/);
  assert.equal(calls.encode[0].inputPath, 'segment-one');
  assert.equal(calls.encode[0].outPath, `artifact://${calls.target[0].name}`);
  assert.equal(calls.metadata[0].filePath, `artifact://${calls.target[0].name}`);
  assert.deepEqual(result, {
    written: [`${calls.target[0].name}.jpg`],
    skipped: 0,
    clamped: 0,
  });
});

test('does not allocate an artifact when a planned span has no footage', async () => {
  let targets = 0;
  const result = await renderContactSheets({
    segments: [],
    plan: [{
      kind: 'hour',
      start: new Date('2026-08-15T10:00:00Z'),
      end: new Date('2026-08-15T11:00:00Z'),
      labels: [],
    }],
    camera: 'front-door',
    outDir: 'day-sheets',
    encoder: {},
    profile: { grid: '2x2' },
    sheetArtifacts: {
      async prepare() {},
      target() { targets++; return null; },
    },
    logger: {},
  });

  assert.equal(targets, 0);
  assert.deepEqual(result, { written: [], skipped: 1, clamped: 0 });
});
