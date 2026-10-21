import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { YamlDebriefStore } from "../../../../__app_modules/learning/school/server/adapters/persistence/YamlDebriefStore.mjs";

let root, store;
const configService = { getHouseholdPath: (rel) => path.join(root, rel) };
const silent = { info() {}, warn() {}, error() {}, debug() {} };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-'));
  store = new YamlDebriefStore({ configService, logger: silent, clock: () => new Date('2026-10-21T22:00:00Z') });
});
const file = (day) => path.join(root, 'school/records/debriefs/test-learner', `${day}.yml`);

describe('YamlDebriefStore', () => {
  it('reads missing as empty', async () => {
    expect(await store.read('test-learner', '2026-10-21')).toEqual({ status: 'missing', events: [] });
  });
  it('appends in order and reads back', async () => {
    await store.append('test-learner', '2026-10-21', { type: 'opened', at: 'a' });
    await store.append('test-learner', '2026-10-21', { type: 'entry', promptId: 'classes', text: 'math', at: 'b' });
    const r = await store.read('test-learner', '2026-10-21');
    expect(r.status).toBe('ok');
    expect(r.events.map((e) => e.type)).toEqual(['opened', 'entry']);
  });
  it('serializes concurrent appends (no lost event)', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => store.append('test-learner', '2026-10-21', { type: 'entry', promptId: `p${n}`, at: String(n) })));
    expect((await store.read('test-learner', '2026-10-21')).events).toHaveLength(5);
  });
  it('preserves a corrupt shard and starts fresh', async () => {
    fs.mkdirSync(path.dirname(file('2026-10-21')), { recursive: true });
    fs.writeFileSync(file('2026-10-21'), ':::not yaml: [');
    expect((await store.read('test-learner', '2026-10-21')).status).toBe('corrupt');
    await store.append('test-learner', '2026-10-21', { type: 'opened', at: 'a' });
    const side = fs.readdirSync(path.dirname(file('2026-10-21'))).filter((f) => f.includes('.corrupt-'));
    expect(side).toHaveLength(1);
    expect((await store.read('test-learner', '2026-10-21')).events).toHaveLength(1);
  });
  it('refuses unsafe ids and bad days', async () => {
    await expect(store.append('../x', '2026-10-21', { type: 'opened' })).rejects.toThrow();
    await expect(store.append('test-learner', '2026-1-1', { type: 'opened' })).rejects.toThrow();
  });
  it('lists days in a range', async () => {
    await store.append('test-learner', '2026-10-20', { type: 'opened', at: 'a' });
    await store.append('test-learner', '2026-10-22', { type: 'opened', at: 'a' });
    expect(await store.listDays('test-learner', { from: '2026-10-19', to: '2026-10-21' })).toEqual(['2026-10-20']);
  });
});
