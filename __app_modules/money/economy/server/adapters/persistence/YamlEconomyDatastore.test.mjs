import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlEconomyDatastore } from "./YamlEconomyDatastore.mjs";
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const USER = 'test-user';
let USER_DIR;
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
};
const makeStore = () => new YamlEconomyDatastore({ configService });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txn = (n, over = {}) => ({ id: `txn_${n}`, at: '2026-10-19T10:00:00.000Z', kind: 'earn', delta: 1, action: 'x', source: 't', ref: null, currency: 'silver', ...over });

beforeEach(() => { USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-ds-')); });
afterEach(() => { fs.rmSync(USER_DIR, { recursive: true, force: true }); });

describe('YamlEconomyDatastore', () => {
  it('requires configService', () => {
    expect(() => new YamlEconomyDatastore({})).toThrow(/configService/);
  });
  it('appends transactions to a date-sharded ledger file and reads them back', async () => {
    const ds = makeStore();
    const t1 = { id: 'txn_a', at: '2026-07-17T10:00:00.000Z', kind: 'deposit', delta: 10, action: 'parent-deposit', source: 'admin', ref: null };
    const t2 = { id: 'txn_b', at: '2026-07-17T11:00:00.000Z', kind: 'spend', delta: -3, action: 'arcade-play', source: 'emulator', ref: 'ses_1' };
    expect(await ds.appendTransaction(USER, t1)).toEqual(t1);
    await ds.appendTransaction(USER, t2);
    const day = ds.readLedgerDay(USER, '2026-07-17');
    expect(day).toHaveLength(2);
    expect(day[1].delta).toBe(-3);
    expect(fs.existsSync(path.join(USER_DIR, 'apps', 'economy', 'ledger', '2026-07-17.yml'))).toBe(true);
  });
  it('reads all ledger days in order', async () => {
    const ds = makeStore();
    await ds.appendTransaction(USER, { id: 'txn_1', at: '2026-07-16T10:00:00.000Z', kind: 'earn', delta: 5, action: 'x', source: 't', ref: null });
    await ds.appendTransaction(USER, { id: 'txn_2', at: '2026-07-17T10:00:00.000Z', kind: 'earn', delta: 2, action: 'x', source: 't', ref: null });
    const all = ds.readAllTransactions(USER);
    expect(all.map((t) => t.id)).toEqual(['txn_1', 'txn_2']);
  });
  it('round-trips the wallet snapshot, null when absent', () => {
    const ds = makeStore();
    expect(ds.readWallet(USER)).toBeNull();
    ds.writeWallet(USER, { balance: 7, as_of: '2026-07-17T10:00:00.000Z', session: null });
    expect(ds.readWallet(USER).balance).toBe(7);
  });
  it('returns null/empty for unknown users instead of throwing', async () => {
    const ds = makeStore();
    expect(ds.readWallet('nobody')).toBeNull();
    expect(ds.readAllTransactions('nobody')).toEqual([]);
    expect(await ds.appendTransaction('nobody', txn(1))).toBeNull();
  });
});

describe('serialized, atomic appends', () => {
  it('writes atomically: 20 appends from two instances leave one valid file and no staging file', async () => {
    const ds = makeStore();
    const other = makeStore();
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? ds : other).appendTransaction(USER, txn(i))));
    const file = path.join(USER_DIR, 'apps', 'economy', 'ledger', '2026-10-19.yml');
    const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
    expect(parsed).toHaveLength(20);
    expect(new Set(parsed.map((t) => t.id)).size).toBe(20);
    // No staging file left behind by the atomic write.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['2026-10-19.yml']);
  });

  it('withUserLock runs a read-check-write without an append slipping in between', async () => {
    const ds = makeStore();
    await ds.appendTransaction(USER, txn('seed'));
    const seen = [];
    const locked = ds.withUserLock(USER, async () => {
      seen.push(ds.readAllTransactions(USER).length);
      await new Promise((r) => setTimeout(r, 20)); // an await gap an outside append could use
      seen.push(ds.readAllTransactions(USER).length);
      return 'done';
    });
    const outside = ds.appendTransaction(USER, txn('outside'));
    expect(await locked).toBe('done');
    await outside;
    expect(seen).toEqual([1, 1]);
    expect(ds.readAllTransactions(USER)).toHaveLength(2);
  });

  it('an append inside withUserLock does not deadlock', async () => {
    const ds = makeStore();
    const result = await ds.withUserLock(USER, async () => {
      await ds.appendTransaction(USER, txn('a'));
      await ds.appendTransaction(USER, txn('b'));
      return ds.readAllTransactions(USER).map((t) => t.id);
    });
    expect(result).toEqual(['txn_a', 'txn_b']);
  });

  it('a lock body that throws rejects its caller and frees the queue', async () => {
    const ds = makeStore();
    await expect(ds.withUserLock(USER, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await ds.appendTransaction(USER, txn('after'));
    expect(ds.readAllTransactions(USER).map((t) => t.id)).toEqual(['txn_after']);
  });

  it('an append from a timer that outlives its lock goes through the queue', async () => {
    const ds = makeStore();
    let late;
    await ds.withUserLock(USER, () => {
      late = new Promise((resolve, reject) => {
        setTimeout(() => ds.appendTransaction(USER, txn('late')).then(resolve, reject), 10);
      });
    });
    // A second lock, taken after the first released, holds the queue past the timer.
    let seenAtEnd;
    const second = ds.withUserLock(USER, async () => {
      await sleep(40);
      seenAtEnd = ds.readAllTransactions(USER).length;
    });
    await second;
    await late;
    expect(seenAtEnd).toBe(0);
    expect(ds.readAllTransactions(USER).map((t) => t.id)).toEqual(['txn_late']);
  });
});

describe('a corrupt day shard', () => {
  it('refuses the append and leaves the file as it was', async () => {
    const ds = makeStore();
    const dir = path.join(USER_DIR, 'apps', 'economy', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '2026-10-19.yml');
    const broken = '- id: txn_old\n  delta: [unclosed\n';
    fs.writeFileSync(file, broken);
    await expect(ds.appendTransaction(USER, txn('new'))).rejects.toThrow(InfrastructureError);
    expect(fs.readFileSync(file, 'utf8')).toBe(broken);
  });
});

describe('readAllTransactions', () => {
  it('skips shards before fromDay', async () => {
    const ds = makeStore();
    await ds.appendTransaction(USER, txn('old', { at: '2026-10-17T10:00:00.000Z' }));
    await ds.appendTransaction(USER, txn('new', { at: '2026-10-18T10:00:00.000Z' }));
    expect(ds.readAllTransactions(USER, { fromDay: '2026-10-18' }).map((t) => t.id)).toEqual(['txn_new']);
  });
});
