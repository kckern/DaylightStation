import { expect, test } from '@playwright/test';

const dbName = 'weekly-review-chunks-v1';
const week = '2026-11-14';
const sessionId = 'saved-review';

async function seedDraftAndFailFirstOpen(page) {
  await page.evaluate(async ({ dbName, week, sessionId }) => {
    const open = indexedDB.open.bind(indexedDB);
    const db = await new Promise((resolve, reject) => {
      const request = open(dbName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('savedAt', 'savedAt');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put({ sessionId, seq: 0, week, uploaded: false, savedAt: Date.now(),
        blob: new Blob([new Uint8Array([1, 2, 3])]) });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    window.recordingDatabaseOpens = 0;
    indexedDB.open = (name, ...args) => {
      if (name === dbName && ++window.recordingDatabaseOpens === 1) {
        throw new DOMException('Fixture temporary database error', 'UnknownError');
      }
      return open(name, ...args);
    };
  }, { dbName, week, sessionId });
}

async function readDraftRows(page) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = IDBFactory.prototype.open.call(indexedDB, name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('chunks').objectStore('chunks').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result.length); };
    };
  }), dbName);
}

test('Weekly Review recovers a local recording after its first database open fails', async ({ page }) => {
  const writes = [];
  const errors = [];
  let refreshed = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', socket => socket.close({ code: 1001, reason: 'Fixture audio is disabled' }));
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {
    value: { async getUserMedia() { throw new DOMException('Fixture microphone disabled', 'NotAllowedError'); } },
  }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let json = {};
    if (url.pathname.endsWith('/supervision/bootstrap')) json = { enabled: false };
    if (url.pathname.endsWith('/weekly-review/bootstrap')) {
      if (url.searchParams.has('week')) refreshed = true;
      json = { week, days: [{ date: week, label: 'Day', photos: [], photoCount: 0, calendar: [], fitness: [], columnWeight: 1 }],
        recording: { exists: refreshed } };
    }
    if (url.pathname.endsWith('/recording/drafts')) json = { drafts: [] };
    if (/\/weekly-review\/recording\/(chunk|finalize)$/.test(url.pathname)) {
      writes.push({ method: route.request().method(), endpoint: url.pathname.split('/').at(-1), body: route.request().postDataJSON() });
      json = { ok: true };
    }
    return route.fulfill({ json });
  });
  await page.goto('/app/fixture-start');
  await expect(page.getByRole('heading', { name: 'App Container' })).toBeVisible();
  await seedDraftAndFailFirstOpen(page);
  await page.evaluate(() => {
    history.pushState(null, '', '/app/weekly-review');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByText('Local-only draft · 1 chunks')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.recordingDatabaseOpens)).toBe(2);
  await page.getByRole('button', { name: 'Finalize Previous' }).click();
  await expect.poll(() => refreshed).toBe(true);
  expect(writes).toEqual([
    { method: 'POST', endpoint: 'chunk', body: { sessionId, seq: 0, week, chunkBase64: 'AQID' } },
    { method: 'POST', endpoint: 'finalize', body: { sessionId, week, duration: 5 } },
  ]);
  expect(await readDraftRows(page)).toBe(0);
  expect(errors).toEqual([]);
});
