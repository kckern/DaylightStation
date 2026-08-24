import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlTeacherActionReceiptStore } from './YamlTeacherActionReceiptStore.mjs';

const roots = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teacher-receipts-'));
  roots.push(root);
  return new YamlTeacherActionReceiptStore({ configService: { getHouseholdPath: (relative) => path.join(root, relative) } });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlTeacherActionReceiptStore', () => {
  it('atomically claims, completes, and replays a key', async () => {
    const store = await fixture();
    await expect(store.claim({ key: 'one', fingerprint: 'fp-1', at: 't1' })).resolves.toEqual({ kind: 'new' });
    await expect(store.claim({ key: 'one', fingerprint: 'fp-1', at: 't2' })).resolves.toEqual({ kind: 'pending' });
    await store.complete({ key: 'one', fingerprint: 'fp-1', receipt: { printed: true }, at: 't3' });
    await expect(store.claim({ key: 'one', fingerprint: 'fp-1', at: 't4' })).resolves.toEqual({ kind: 'replay', receipt: { printed: true } });
    await expect(store.claim({ key: 'one', fingerprint: 'different', at: 't5' })).resolves.toEqual({ kind: 'conflict' });
  });

  it('allows only one concurrent claimant', async () => {
    const store = await fixture();
    const claims = await Promise.all([
      store.claim({ key: 'race', fingerprint: 'fp', at: 't1' }),
      store.claim({ key: 'race', fingerprint: 'fp', at: 't1' }),
    ]);
    expect(claims.map((claim) => claim.kind).sort()).toEqual(['new', 'pending']);
  });

  it('fails closed on a corrupt existing record', async () => {
    const store = await fixture();
    await store.claim({ key: 'corrupt', fingerprint: 'fp', at: 't1' });
    const root = roots.at(-1);
    const files = await fs.readdir(path.join(root, 'school/records/teacher-action-receipts'));
    await fs.writeFile(path.join(root, 'school/records/teacher-action-receipts', files[0]), 'not: [valid', 'utf8');
    await expect(store.claim({ key: 'corrupt', fingerprint: 'fp', at: 't2' })).rejects.toThrow(/corrupt/);
  });
});
