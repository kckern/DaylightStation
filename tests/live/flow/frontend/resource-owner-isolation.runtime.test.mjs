import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('two tabs claiming an initially unowned store cannot relabel another user’s data', async ({ context }) => {
  const source = await readFile(new URL('../../../../frontend/src/lib/hooks/persistentResourceStore.js', import.meta.url), 'utf8');
  await context.route('http://localhost:43891/**', route => {
    const module = route.request().url().endsWith('/store.js');
    return route.fulfill({ contentType: module ? 'text/javascript' : 'text/html', body: module ? source : '<title>Resource store test</title>' });
  });
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all(tabs.map(async page => {
    await page.goto('http://localhost:43891/');
    const owner = await page.evaluate(async () => {
      const { createIdbResourceStore } = await import('/store.js');
      window.store = createIdbResourceStore('resource-owner-test');
      return (await window.store.load()).owner;
    });
    expect(owner).toBeNull();
  }));
  const [alice, bob] = tabs;
  await alice.evaluate(async () => {
    await window.store.put('legacy-unowned', 'unowned', 7);
    await window.store.claimOwner('alice');
  });
  expect(await alice.evaluate(() => window.store.load())).toEqual({ owner: 'alice', entries: [] });
  await alice.evaluate(async () => {
    await window.store.put('day', 'private', 7, 'alice');
  });
  await bob.evaluate(() => window.store.claimOwner('bob'));
  expect(await bob.evaluate(() => window.store.load())).toEqual({ owner: 'bob', entries: [] });
  await bob.evaluate(() => window.store.put('day', 'current', 7, 'bob'));
  await alice.evaluate(async () => {
    await window.store.put('day', 'late', 4, 'alice');
    await window.store.remove('day', 'alice');
  });
  expect(await bob.evaluate(() => window.store.load())).toEqual({ owner: 'bob', entries: [{ path: 'day', value: 'current' }] });
});
