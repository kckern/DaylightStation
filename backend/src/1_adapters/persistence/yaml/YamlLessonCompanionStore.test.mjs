// backend/src/1_adapters/persistence/yaml/YamlLessonCompanionStore.test.mjs
// @vitest-environment node
//
// Concurrent progress saves corrupted a companion record in production.
//
// On 2026-08-26 `ral_h1IAmJ6QEiJi.yml` was left unparseable — an unterminated
// quote and a duplicate `lastUpdatedAt`, the two writes stamped 1ms apart
// (03:24:53.232Z and .233Z). The read-along player writes progress on a 10s
// throttle, on part change AND on unmount, so two saves landing in the same
// millisecond is ordinary, not exotic. Every open after that logged
// `school.companion.unreadable` and the child was refused entry to their own
// lesson.
//
// `update()` was a read-modify-write with a bare `fs.writeFile`: two callers
// read the same base and the loser's changes vanished, and the writes
// themselves could interleave mid-syscall and leave one document's tail
// stitched onto another's body.
//
// These tests use a REAL temp directory. Mocking the filesystem here would
// mock away the exact behaviour under test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { YamlLessonCompanionStore } from '#adapters/persistence/yaml/YamlLessonCompanionStore.mjs';

let dir;
const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };
const storeAt = (root) => new YamlLessonCompanionStore({
  configService: { getHouseholdPath: (rel) => path.join(root, rel) },
  logger: silentLogger,
});
const ID = 'ral_hAbCdEf123';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('YamlLessonCompanionStore under concurrent updates', () => {
  it('keeps both writers changes — neither silently loses the other', async () => {
    const store = storeAt(dir);
    await store.put({ id: ID, state: { parts: {} } });

    await Promise.all([
      store.update(ID, (record) => { record.state.first = 'a'; return record; }),
      store.update(ID, (record) => { record.state.second = 'b'; return record; }),
    ]);

    const final = await store.get(ID);
    expect(final.state.first).toBe('a');
    expect(final.state.second).toBe('b');
  });

  it('never leaves the file unparseable, however many saves collide', async () => {
    const store = storeAt(dir);
    await store.put({ id: ID, state: { parts: {} } });

    // Payloads of differing length are what produced the production
    // corruption: a shorter write over a longer one left the tail behind.
    await Promise.all(Array.from({ length: 24 }, (_, i) => store.update(ID, (record) => {
      record.state.parts[`part-${i}`] = { note: 'x'.repeat((i % 6) * 400) };
      record.state.lastUpdatedAt = `2026-08-26T03:24:53.${200 + i}Z`;
      return record;
    })));

    const raw = await fs.readFile(path.join(dir, 'school/records/companions', `${ID}.yml`), 'utf8');
    expect(() => yaml.load(raw)).not.toThrow();
    // Every collided writer's part survives, not merely the last one.
    expect(Object.keys(yaml.load(raw).state.parts)).toHaveLength(24);
  });

  it('still returns null for a record that was never written', async () => {
    expect(await storeAt(dir).get(ID)).toBeNull();
  });

  it('refuses an unsafe id rather than touching a path outside the store', async () => {
    // `get` deliberately folds every read failure into null; `put` is where
    // the id guard is allowed to surface.
    await expect(storeAt(dir).put({ id: '../../etc/passwd' })).rejects.toThrow(/unsafe/i);
  });
});
