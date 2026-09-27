// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlEarnRulesStore } from './YamlEarnRulesStore.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('YamlEarnRulesStore', () => {
  let root;
  let store;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'earn-rules-'));
    store = new YamlEarnRulesStore({ configService: { getHouseholdPath: (rel) => path.join(root, rel) }, logger: silent });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const doc = (revision) => ({ revision, revisedAt: '2026-09-26T16:00:00.000Z', revisedBy: 'parent', currency: 'silver', rules: [{ id: 'green-day', kind: 'day-met', reward: { silver: revision, gems: 0 } }], users: {} });

  it('reads null before anything is written', async () => {
    expect(await store.read()).toBeNull();
    expect(await store.history()).toEqual([]);
  });

  it('round-trips the current document at economy/earn-rules.yml', async () => {
    await store.write(doc(1), { previous: { revision: 0 } });
    expect(await store.read()).toEqual(doc(1));
    expect(fs.existsSync(path.join(root, 'economy', 'earn-rules.yml'))).toBe(true);
  });

  it('archives each replaced revision (never the unwritten revision 0) and lists history newest first', async () => {
    await store.write(doc(1), { previous: { revision: 0 } });
    await store.write(doc(2), { previous: doc(1) });
    await store.write(doc(3), { previous: doc(2) });
    expect((await store.history()).map((d) => d.revision)).toEqual([2, 1]);
    expect(fs.readdirSync(path.join(root, 'economy', 'earn-rules.history')).sort()).toEqual(['0001.yml', '0002.yml']);
  });

  it('a corrupt file reads as an error, not as "no rules" — silently paying defaults would be wrong', async () => {
    fs.mkdirSync(path.join(root, 'economy'), { recursive: true });
    fs.writeFileSync(path.join(root, 'economy', 'earn-rules.yml'), 'rules: [unclosed');
    await expect(store.read()).rejects.toThrow(/earn-rules/);
  });
});
