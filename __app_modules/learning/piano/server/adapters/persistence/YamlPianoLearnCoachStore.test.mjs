// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlPianoLearnCoachStore } from './YamlPianoLearnCoachStore.mjs';
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
describe('coaching durable receipts', () => {
  it('retains pending recovery and immutable receipts across store instances', () => {
    const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-coach-'));roots.push(usersDir);
    const one = new YamlPianoLearnCoachStore({ usersDir });
    one.savePending('learner4', 'files-test', { id: 'a1', stateAfter: { revision: 1 } });
    const two = new YamlPianoLearnCoachStore({ usersDir });
    expect(two.loadPending('learner4', 'files-test')).toMatchObject({ id: 'a1', stateAfter: { revision: 1 } });
    two.saveReceipt('learner4', 'files-test', 'a1', { signature: 'same', revision: 1 });
    expect(two.getReceipt('learner4', 'files-test', 'a1')).toEqual({ signature: 'same', revision: 1 });
    expect(() => two.saveReceipt('learner4', 'files-test', 'a1', { signature: 'different', revision: 2 })).toThrow();
    two.clearPending('learner4', 'files-test');expect(one.loadPending('learner4', 'files-test')).toBeNull();
  });
  it('refuses traversal through any identity component', () => {
    const store = new YamlPianoLearnCoachStore({ usersDir: '/unused' });
    expect(() => store.getReceipt('../outside', 'files-test', 'a1')).toThrow();
    expect(() => store.getReceipt('learner4', '../outside', 'a1')).toThrow();
    expect(() => store.getReceipt('learner4', 'files-test', '../outside')).toThrow();
  });
});
