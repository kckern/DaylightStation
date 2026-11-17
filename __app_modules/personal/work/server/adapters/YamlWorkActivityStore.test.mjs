import { it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { YamlWorkActivityStore } from './YamlWorkActivityStore.mjs';
import { harness, ref, item } from '../../../../../tests/_lib/work/stateHarness.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
export const activity = (at = Date.parse('2027-01-01T00:30:00Z')) => ({
  id: 'work:' + String(at),
  username: 'sample',
  ref,
  containerRef: item().containerRef,
  assigneeIds: [],
  type: 'completed',
  occurredAt: at,
  observedAt: at,
  providerVersion: 'native-v1',
  occurrenceId: String(at),
  origin: 'provider',
  causationId: null,
  sourceRefs: ['provider:completed'],
  actorId: null,
  occurredAtEstimated: false
});
it('projects actual occurrence dates idempotently and separates users and recurring occurrences', async () => {
  const h = harness();
  resources.push(h);
  let authorized = true;
  const store = new YamlWorkActivityStore({
    rootForUser: u => path.join(h.root, u, 'lifelog'),
    assertWriter: async () => {
      if (!authorized) throw new Error('denied');
    },
    userTimezone: () => 'America/Los_Angeles'
  });
  const a = activity(),
    b = activity(a.occurredAt + 1000);
  expect(await store.read({
    username: 'sample',
    from: a.occurredAt,
    to: b.occurredAt
  })).toEqual([]);
  expect(fs.existsSync(path.join(h.root, 'sample'))).toBe(false);
  expect((await store.upsert({
    username: 'sample',
    event: a
  })).applied).toBe(true);
  expect((await store.upsert({
    username: 'sample',
    event: a
  })).applied).toBe(false);
  await store.upsert({
    username: 'sample',
    event: b
  });
  const text = fs.readFileSync(path.join(h.root, 'sample/lifelog/work.yml'), 'utf8');
  expect(text).toContain('2026-12-31');
  expect(await store.read({
    username: 'sample',
    from: a.occurredAt,
    to: b.occurredAt
  })).toHaveLength(2);
  expect(await store.read({
    username: 'other',
    from: 0,
    to: b.occurredAt
  })).toEqual([]);
  authorized = false;
  await expect(store.upsert({
    username: 'sample',
    event: activity(b.occurredAt + 1)
  })).rejects.toThrow('denied');
});
it('preserves a corrupt projection instead of overwriting it', async () => {
  const h = harness();
  resources.push(h);
  const store = new YamlWorkActivityStore({
    rootForUser: u => path.join(h.root, u, 'lifelog'),
    assertWriter: async () => {},
    userTimezone: () => 'America/Los_Angeles'
  });
  const file = path.join(h.root, 'sample/lifelog/work.yml');
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });
  fs.writeFileSync(file, 'invalid: [');
  await expect(store.upsert({
    username: 'sample',
    event: activity()
  })).rejects.toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe('invalid: [');
});
