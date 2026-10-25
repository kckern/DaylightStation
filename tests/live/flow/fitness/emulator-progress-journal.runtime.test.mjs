import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Fully intercepted synthetic origin: no household application state is touched.
const origin = 'https://emulator-journal.example.test';
async function openJournal(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<script type="module">import {createCheckpointJournal} from "/checkpointJournal.js";window.createJournal=createCheckpointJournal;window.journal=createCheckpointJournal();</script>' });
    if (['/checkpointJournal.js', '/checkpointClient.js'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.resolve('__app_modules/games/emulator/browser/core', url.pathname.slice(1)), 'utf8') });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => !!window.journal);
}
const capture = {
  key: { system: 'gb', gameId: 'example-quest', user: 'user_5' },
  captureId: 'capture-one', sessionId: 'session-one', sequence: 1, expectedRevision: null,
  previousCaptureId: null, createdAt: 1000, saveMode: 'battery',
  provenance: { romHash: 'a'.repeat(64), core: { name: 'gambatte', bundleHash: 'b'.repeat(64), format: 1, variant: 'wasm' } },
};
test.describe('durable emulator journal with real IndexedDB', () => {
  test('archives only explicitly resolved branches atomically and retains their bytes across reload', async ({ page }) => {
    await openJournal(page);
    const before = await page.evaluate(async input => {
      const first = await journal.put({ ...input, snapshot: new Uint8Array([1]), battery: new Uint8Array([2]) });
      const second = await journal.put({ ...input, captureId: 'second', snapshot: new Uint8Array([3]), battery: new Uint8Array([4]) });
      let wrong;
      try { await journal.archive(input.key, [first, { ...second, fingerprint: 'wrong' }]); } catch (error) { wrong = error.code; }
      const untouched = [(await journal.list(input.key)).length, (await journal.listArchived(input.key)).length];
      await journal.archive(input.key, [first, second]);
      let reuse;
      try { await journal.put({ ...input, snapshot: new Uint8Array([9]), battery: new Uint8Array([2]) }); } catch (error) { reuse = error.code; }
      return { wrong, reuse, untouched, remaining: (await journal.list(input.key)).length };
    }, capture);
    expect(before).toEqual({ wrong: 'ECHECKPOINTJOURNALCONFLICT', reuse: 'ECHECKPOINTJOURNALCONFLICT', untouched: [2, 0], remaining: 0 });
    await page.reload(); await page.waitForFunction(() => !!window.journal);
    const after = await page.evaluate(async key => (await journal.listArchived(key)).map(record => [...record.snapshot]), capture.key);
    expect(after.sort()).toEqual([[1], [3]]);
  });
  test('retains bytes across reload and removes only the acknowledged record', async ({ page }) => {
    await openJournal(page);
    const fingerprint = await page.evaluate(async input => {
      const record = await journal.put({ ...input, snapshot: new Uint8Array([1, 2, 3]), battery: new Uint8Array([4, 5]) });
      return record.fingerprint;
    }, capture);
    await page.reload(); await page.waitForFunction(() => !!window.journal);
    const loaded = await page.evaluate(async key => (await journal.list(key)).map(r => ({ snapshot: [...r.snapshot], battery: [...r.battery], fingerprint: r.fingerprint })), capture.key);
    expect(loaded).toEqual([{ snapshot: [1, 2, 3], battery: [4, 5], fingerprint }]);
    await page.evaluate(async ({ input, fingerprint }) => journal.acknowledge(input.key, input.captureId, fingerprint), { input: capture, fingerprint });
    expect(await page.evaluate(key => journal.list(key), capture.key)).toEqual([]);
  });
  test('keeps different players and games separate', async ({ page }) => {
    await openJournal(page);
    const result = await page.evaluate(async input => {
      for (const user of ['user_5', 'user_4']) await journal.put({ ...input, key: { ...input.key, user }, snapshot: new Uint8Array([1]), battery: new Uint8Array([2]) });
      return [(await journal.list(input.key)).length, (await journal.list({ ...input.key, user: 'user_4' })).length, (await journal.list({ ...input.key, gameId: 'another-game' })).length];
    }, capture);
    expect(result).toEqual([1, 1, 0]);
  });
  test('rejects capture reuse and wrong acknowledgments while preserving the original', async ({ page }) => {
    await openJournal(page);
    const result = await page.evaluate(async input => {
      const record = { ...input, snapshot: new Uint8Array([1]), battery: new Uint8Array([2]) };
      const first = await journal.put(record);
      const duplicate = await journal.put(record);
      let collision, acknowledgment;
      try { await journal.put({ ...record, snapshot: new Uint8Array([9]) }); } catch (e) { collision = e.code; }
      try { await journal.acknowledge(input.key, input.captureId, 'wrong'); } catch (e) { acknowledgment = e.code; }
      const remaining = await journal.list(input.key);
      return { same: first.fingerprint === duplicate.fingerprint, collision, acknowledgment, remaining: remaining.map(r => [...r.snapshot]) };
    }, capture);
    expect(result).toEqual({ same: true, collision: 'ECHECKPOINTJOURNALCONFLICT', acknowledgment: 'ECHECKPOINTJOURNALCONFLICT', remaining: [[1]] });
  });
  test('surfaces missing storage and aborted transactions instead of acknowledging durability', async ({ page }) => {
    await openJournal(page);
    const result = await page.evaluate(async input => {
      const record = { ...input, snapshot: new Uint8Array([1]), battery: new Uint8Array([2]) };
      let unavailable, aborted;
      try { await createJournal({ indexedDB: null }).put(record); } catch (e) { unavailable = e.code; }
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = transaction.apply(this, args);
        if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
        return tx;
      };
      try { await journal.put(record); } catch (e) { aborted = e.code; }
      finally { IDBDatabase.prototype.transaction = transaction; }
      return { unavailable, aborted, remaining: (await journal.list(input.key)).length };
    }, capture);
    expect(result).toEqual({ unavailable: 'ECHECKPOINTJOURNALUNAVAILABLE', aborted: 'ECHECKPOINTJOURNALUNAVAILABLE', remaining: 0 });
  });
});
