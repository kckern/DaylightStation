import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  isPrefetchIdle, peekApiResource, prefetchApiResources, resetApiResourceCache, useApiResource,
} from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { HealthOperationsProvider, useHealthOperations } from './HealthOperationsProvider.jsx';

const DATE = '2026-10-25';
const DAY_PATH = 'api/v1/health/day?date=2026-10-25';
const WRITE_PATH = 'api/v1/health/nutrilist/group';
const GROUP = { uuid: 'group', kind: 'group', date: DATE, version: 1, calories: 0 };
const EGGS = { uuid: 'eggs', kind: 'item', parentId: 'group', date: DATE, version: 1, calories: 50 };
const BEFORE = { items: [GROUP, EGGS], budget: { food: 50, remaining: 950 }, revision: 1 };
const SAVED = { items: [GROUP, { ...EGGS, version: 2, calories: 100 }], budget: { food: 100, remaining: 900 }, revision: 2 };
const ACKNOWLEDGEMENT = {
  data: GROUP, versions: { group: 1, eggs: 2 }, affectedIds: ['group', 'eggs'], affectedDates: [DATE], cascadedIds: ['eggs'],
};

const Operations = ({ children }) => <HealthOperationsProvider userId="u">{children}</HealthOperationsProvider>;

function beginGroupUpdate(operations, id, update) {
  operations.store.begin({
    id, date: DATE, targetIds: ['group', 'eggs'],
    request: { path: WRITE_PATH, method: 'PUT', body: {
      operationId: id, expectedVersion: 1, expectedVersions: { group: 1, eggs: 1 }, ...update,
    } },
  });
  return operations.execute(id);
}

const adjustGroup = operations => beginGroupUpdate(operations, 'edit-group', {
  adjustment: { field: 'calories', value: 100 }, expectedDensityRevision: 'density-fixture',
});

function getRoute(url) {
  const { pathname, search } = new URL(url);
  return `${pathname.slice(1)}${search}`;
}

afterEach(() => {
  resetApiResourceCache();
  vi.unstubAllGlobals();
});

it('dispatches once and ignores an old owner completion after unmount', async () => {
  let finish;
  const send = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const complete = vi.fn();
  const wrapper = ({children}) => <HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
  const { result, unmount } = renderHook(useHealthOperations, { wrapper });
  let pending;
  act(() => {
    result.current.store.begin({id:'one',targetIds:['a'],request:{path:'test',body:{operationId:'one'},method:'POST'}});
    pending = result.current.execute('one', complete);
    result.current.execute('one', complete);
  });
  expect(send).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish({committed:true}); await pending; });
  expect(complete).not.toHaveBeenCalled();
});

it('publishes a retried reconciliation read to a mounted warm day after one acknowledged write', async () => {
  const canonical = Promise.withResolvers();
  const dayResponses = [
    Response.json(BEFORE), Response.json({ error: 'refresh offline' }, { status: 503 }),
    Response.json(SAVED), canonical.promise,
  ];
  const writes = [];
  vi.stubGlobal('fetch', async (url, { method, body }) => {
    const route = getRoute(url);
    if (method === 'PUT' && route === WRITE_PATH) {
      writes.push(JSON.parse(body).operationId);
      return Response.json(ACKNOWLEDGEMENT);
    }
    expect([method, route]).toEqual(['GET', DAY_PATH]);
    return dayResponses.shift();
  });
  const { result } = renderHook(() => ({
    operations: useHealthOperations(), day: useApiResource(DAY_PATH, { swr: true }),
  }), { wrapper: Operations });
  await waitFor(() => expect(result.current.day.data).toEqual(BEFORE));

  await act(async () => {
    await expect(adjustGroup(result.current.operations)).rejects.toThrow(/refresh offline/);
  });
  expect(result.current.operations.store.isReserved(['eggs'])).toBe(true);
  expect(result.current.day.data).toEqual(BEFORE);

  await act(() => result.current.operations.retry('edit-group'));
  expect(writes).toEqual(['edit-group']);
  expect(result.current.operations.store.isReserved(['eggs'])).toBe(false);
  expect(result.current.day).toMatchObject({ data: SAVED, loading: false, revalidating: true });
  expect(peekApiResource(DAY_PATH)).toMatchObject(SAVED);

  await act(async () => { canonical.resolve(Response.json({ ...SAVED, revision: 3 })); });
  expect(result.current.day).toMatchObject({ data: { revision: 3 }, revalidating: false });
});

it('publishes a cold day during multi-date reconciliation and retires its pre-write read', async () => {
  const destinationDate = '2026-10-26';
  const destinationPath = 'api/v1/health/day?date=2026-10-26';
  const moved = [{ ...GROUP, date: destinationDate, version: 2 }, { ...EGGS, date: destinationDate, version: 2 }];
  const source = { items: [], budget: { food: 0, remaining: 1000 }, revision: 2 };
  const destination = { items: moved, budget: { food: 50, remaining: 950 }, revision: 2 };
  const preWrite = Promise.withResolvers();
  const destinationRead = Promise.withResolvers();
  const destinationStarted = Promise.withResolvers();
  const canonical = Promise.withResolvers();
  const dayResponses = [preWrite.promise, Response.json(source)];
  const writes = [];
  vi.stubGlobal('fetch', async (url, { method, body }) => {
    const route = getRoute(url);
    if (method === 'PUT' && route === WRITE_PATH) {
      writes.push(JSON.parse(body));
      return Response.json({
        data: moved[0], versions: { group: 2, eggs: 2 }, affectedIds: ['group', 'eggs'],
        affectedDates: [DATE, destinationDate], cascadedIds: ['eggs'],
      });
    }
    if (method === 'GET' && route === destinationPath) {
      destinationStarted.resolve();
      return destinationRead.promise;
    }
    expect([method, route]).toEqual(['GET', DAY_PATH]);
    return dayResponses.shift() ?? canonical.promise.then(snapshot => Response.json(snapshot));
  });
  expect(prefetchApiResources([DAY_PATH])).toBe(1);
  const { result } = renderHook(() => ({
    operations: useHealthOperations(), day: useApiResource(DAY_PATH, { swr: true }),
  }), { wrapper: Operations });
  expect(result.current.day.loading).toBe(true);
  expect(peekApiResource(DAY_PATH)).toBeUndefined();

  let request;
  await act(async () => {
    request = beginGroupUpdate(result.current.operations, 'move-group', { date: destinationDate });
    await destinationStarted.promise;
  });
  expect(result.current.operations.snapshot.operations.get('move-group').phase).toBe('reconciling');
  expect(peekApiResource(DAY_PATH)).toMatchObject(source);
  const published = result.current.day;
  await act(async () => { preWrite.resolve(Response.json(BEFORE)); });
  expect(isPrefetchIdle()).toBe(true);
  expect(peekApiResource(DAY_PATH)).toMatchObject(source);
  expect(published).toMatchObject({ data: source, loading: false, revalidating: true });
  expect(result.current.day).toMatchObject({ data: source, loading: false });

  await act(async () => { destinationRead.resolve(Response.json(destination)); await request; });
  expect(result.current.operations.snapshot.operations.get('move-group').phase).toBe('succeeded');
  expect(peekApiResource(destinationPath)).toMatchObject(destination);
  expect(writes).toEqual([{
    operationId: 'move-group', date: destinationDate, expectedVersion: 1, expectedVersions: { group: 1, eggs: 1 },
  }]);
  await act(async () => { canonical.resolve({ ...source, revision: 3 }); });
  expect(result.current.day).toMatchObject({ data: { revision: 3 }, revalidating: false });
});

it('discards an acknowledged reconciliation read from the previous confirmed user', async () => {
  let owner = 'first';
  const started = Promise.withResolvers();
  const read = Promise.withResolvers();
  vi.stubGlobal('fetch', async (url, { method }) => {
    const route = getRoute(url);
    if (method === 'PUT' && route === WRITE_PATH) return Response.json(ACKNOWLEDGEMENT);
    expect([method, route]).toEqual(['GET', DAY_PATH]);
    started.resolve();
    return read.promise;
  });
  const wrapper = ({ children }) => <HealthOperationsProvider userId={owner}>{children}</HealthOperationsProvider>;
  const { result, rerender } = renderHook(useHealthOperations, { wrapper });

  let request;
  await act(async () => {
    request = adjustGroup(result.current);
    await started.promise;
  });
  expect(result.current.snapshot.operations.get('edit-group').phase).toBe('reconciling');
  owner = 'second';
  rerender();
  await act(async () => { read.resolve(Response.json(SAVED)); await request; });

  expect(peekApiResource(DAY_PATH)).toBeUndefined();
  expect(result.current.snapshot.operations.size).toBe(0);
  expect(result.current.snapshot.userId).toBe('second');
});

it('keeps affected foods locked when a reconciliation snapshot is behind acknowledged versions',async()=>{
 const send=async path=>path.endsWith('/a')?{data:{uuid:'a',version:2},versions:{a:2}}:{items:[{uuid:'a',date:'2026-10-25',version:1}]};
 const wrapper=({children})=><HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
 const {result}=renderHook(useHealthOperations,{wrapper});
 act(()=>result.current.store.begin({id:'stale',date:'2026-10-25',targetIds:['a'],request:{path:'api/v1/health/nutrilist/a',body:{},method:'PUT'}}));
 await act(async()=>{await expect(result.current.execute('stale')).rejects.toThrow(/refresh/i);});
 expect(result.current.store.isReserved(['a'])).toBe(true);
});
