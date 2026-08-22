import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FeedbackService, feedbackItemPath } from './FeedbackService.mjs';

/**
 * Covers the two riskiest edges of the month-partitioning refactor that the
 * pure feedbackItemPath() tests (FeedbackService.paths.test.mjs) and the
 * existing create()/get()-only notify suite (tests/isolated/feedback/) don't
 * touch: list()'s switch to a recursive scan, and remove()'s deleteYaml
 * extension-strip. Both run against a real tmp-dir filesystem — no mocks,
 * no data volume.
 */

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function makeService(dir, extra = {}) {
  const configService = {
    getMediaDir: () => path.join(dir, 'media'),
    getHouseholdPath: (rel) => path.join(dir, 'household', rel),
  };
  return new FeedbackService({ configService, logger: noopLogger, ...extra });
}

function itemsRootOf(dir) {
  return path.join(dir, 'household', 'feedback');
}

test('list() finds both a pre-migration flat item and a month-partitioned item', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-list-mixed-'));
  try {
    const itemsRoot = itemsRootOf(dir);

    // A month-partitioned item, written directly so the fixture is exact and
    // doesn't depend on "today" at test-run time.
    const partitionedDir = path.join(itemsRoot, 'piano', '2026-08');
    mkdirSync(partitionedDir, { recursive: true });
    writeFileSync(
      path.join(partitionedDir, '20260815120000_aaaaaa.yml'),
      "id: 20260815120000_aaaaaa\napp: piano\ncreated: '2026-08-15T12:00:00.000Z'\nstatus: new\n",
    );

    // A pre-migration item still sitting flat in {app}/ — the transition
    // window this refactor has to keep reading correctly.
    writeFileSync(
      path.join(itemsRoot, 'piano', '20260701090000_bbbbbb.yml'),
      "id: 20260701090000_bbbbbb\napp: piano\ncreated: '2026-07-01T09:00:00.000Z'\nstatus: new\n",
    );

    const service = makeService(dir);
    const ids = service.list({ app: 'piano' }).map((i) => i.id).sort();

    assert.deepEqual(ids, ['20260701090000_bbbbbb', '20260815120000_aaaaaa']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remove() actually deletes the file from disk, not just returns true', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-remove-'));
  try {
    const service = makeService(dir);
    const item = await service.create({ app: 'piano', audioBuffer: null, context: {} });
    const file = feedbackItemPath(itemsRootOf(dir), 'piano', item.id);
    assert.equal(existsSync(file), true, 'sanity: item file exists before remove');

    const ok = service.remove('piano', item.id);

    assert.equal(ok, true);
    assert.equal(existsSync(file), false, 'file must actually be gone from disk, not just report success');
    assert.equal(service.get('piano', item.id), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update() round-trips through the month-partitioned path', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-update-'));
  try {
    const service = makeService(dir);
    const item = await service.create({ app: 'fitness', audioBuffer: null, context: {} });

    const updated = service.update('fitness', item.id, { status: 'triaged', notes: 'looked into it' });

    assert.equal(updated.status, 'triaged');
    assert.equal(updated.notes, 'looked into it');
    assert.deepEqual(service.get('fitness', item.id), updated);

    const file = feedbackItemPath(itemsRootOf(dir), 'fitness', item.id);
    assert.equal(existsSync(file), true, 'the update write landed at the month-partitioned path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('get() returns null for a malformed id instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-get-malformed-'));
  try {
    const service = makeService(dir);
    assert.equal(service.get('piano', 'not-a-real-id'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('get() does NOT swallow a genuine parse/I-O error behind the id-format guard', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-get-corrupt-'));
  try {
    const monthDir = path.join(itemsRootOf(dir), 'piano', '2026-08');
    mkdirSync(monthDir, { recursive: true });
    const id = '20260815120000_cccccc';
    // Well-formed id (feedbackItemPath resolves it fine) but genuinely
    // corrupt YAML content, so loadYaml itself throws.
    writeFileSync(path.join(monthDir, `${id}.yml`), 'key: [unterminated flow sequence\n');

    const service = makeService(dir);

    // Before this refactor, get() had no try/catch at all, so a parse error
    // propagated. The id-format guard added for feedbackItemPath() must not
    // widen to also catch this — a real corruption/permission failure has to
    // surface as a real error, not get reinterpreted as "not found".
    assert.throws(() => service.get('piano', id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
