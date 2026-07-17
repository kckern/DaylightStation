import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { YamlEconomyDatastore } from './YamlEconomyDatastore.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-ds-test-user';
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
};
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };
const makeStore = () => new YamlEconomyDatastore({ configService });

beforeEach(clean);
afterEach(clean);

describe('YamlEconomyDatastore', () => {
  it('requires configService', () => {
    expect(() => new YamlEconomyDatastore({})).toThrow(/configService/);
  });
  it('appends transactions to a date-sharded ledger file and reads them back', () => {
    const ds = makeStore();
    const t1 = { id: 'txn_a', at: '2026-07-17T10:00:00.000Z', kind: 'deposit', delta: 10, action: 'parent-deposit', source: 'admin', ref: null };
    const t2 = { id: 'txn_b', at: '2026-07-17T11:00:00.000Z', kind: 'spend', delta: -3, action: 'arcade-play', source: 'emulator', ref: 'ses_1' };
    ds.appendTransaction(USER, t1);
    ds.appendTransaction(USER, t2);
    const day = ds.readLedgerDay(USER, '2026-07-17');
    expect(day).toHaveLength(2);
    expect(day[1].delta).toBe(-3);
    expect(fs.existsSync(path.join(USER_DIR, 'apps', 'economy', 'ledger', '2026-07-17.yml'))).toBe(true);
  });
  it('reads all ledger days in order', () => {
    const ds = makeStore();
    ds.appendTransaction(USER, { id: 'txn_1', at: '2026-07-16T10:00:00.000Z', kind: 'earn', delta: 5, action: 'x', source: 't', ref: null });
    ds.appendTransaction(USER, { id: 'txn_2', at: '2026-07-17T10:00:00.000Z', kind: 'earn', delta: 2, action: 'x', source: 't', ref: null });
    const all = ds.readAllTransactions(USER);
    expect(all.map((t) => t.id)).toEqual(['txn_1', 'txn_2']);
  });
  it('round-trips the wallet snapshot, null when absent', () => {
    const ds = makeStore();
    expect(ds.readWallet(USER)).toBeNull();
    ds.writeWallet(USER, { balance: 7, as_of: '2026-07-17T10:00:00.000Z', session: null });
    expect(ds.readWallet(USER).balance).toBe(7);
  });
  it('returns null/empty for unknown users instead of throwing', () => {
    const ds = makeStore();
    expect(ds.readWallet('nobody')).toBeNull();
    expect(ds.readAllTransactions('nobody')).toEqual([]);
  });
});
