import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));

const { default: usePeopleDirectory } = await import('./usePeopleDirectory.js');

const reply = (status, body, etag) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) },
});
const person = { person: { kind: 'user', id: 'learner-a' }, display: { name: 'Person A', avatar: null }, active: true };
const created = id => ({ person: { kind: 'guest', id }, display: { name: 'Visitor', avatar: null }, active: true });

let fetchMock;
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url), method: init?.method || 'GET', ifMatch: init?.headers?.['If-Match'], body: init?.body ? JSON.parse(init.body) : undefined,
}));
const posts = () => calls().filter(c => c.method === 'POST');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const fn of Object.values(log)) fn.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function loaded() {
  const hook = renderHook(() => usePeopleDirectory());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

it('loads the directory and sends the strong ETag as If-Match when creating a guest', async () => {
  fetchMock
    .mockResolvedValueOnce(reply(200, { people: [person] }, '"3"'))
    .mockImplementationOnce(async (_url, init) => reply(201, created(JSON.parse(init.body).id), '"4"'));
  const { result } = await loaded();
  expect(result.current.people).toEqual([person]);
  expect(calls()[0].url).toMatch(/\/api\/v1\/admin\/people\?includeArchived=true$/);
  let entry;
  await act(async () => { entry = await result.current.createGuest('Visitor'); });
  const [post] = posts();
  expect(post.url).toMatch(/\/api\/v1\/admin\/people\/guests$/);
  expect(post.ifMatch).toBe('"3"');
  expect(post.body).toEqual({ id: expect.stringMatching(/^guest_/), name: 'Visitor' });
  expect(entry.person.id).toBe(post.body.id);
  expect(result.current.people.map(p => p.person.id)).toEqual(['learner-a', post.body.id]);
});

for (const [label, status, body] of [
  ['409 revision_conflict', 409, { code: 'revision_conflict', message: 'Stale' }],
  ['428 precondition_required', 428, { code: 'precondition_required', message: 'Revision required' }],
]) {
  it(`reloads once and retries with the same guest id after a ${label}`, async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { people: [person] }, '"3"'))
      .mockResolvedValueOnce(reply(status, body))
      .mockResolvedValueOnce(reply(200, { people: [person] }, '"5"'))
      .mockImplementationOnce(async (_url, init) => reply(201, created(JSON.parse(init.body).id), '"6"'));
    const { result } = await loaded();
    await act(async () => { await result.current.createGuest('Visitor'); });
    const [first, second] = posts();
    expect(posts()).toHaveLength(2);
    expect(second.body.id).toBe(first.body.id);
    expect(first.ifMatch).toBe('"3"');
    expect(second.ifMatch).toBe('"5"');
    expect(log.warn).not.toHaveBeenCalledWith('people.guest.create.failed', expect.anything());
  });
}

it('surfaces a second failure as an error and logs it', async () => {
  fetchMock
    .mockResolvedValueOnce(reply(200, { people: [person] }, '"3"'))
    .mockResolvedValueOnce(reply(409, { code: 'revision_conflict', message: 'Stale' }))
    .mockResolvedValueOnce(reply(200, { people: [person] }, '"5"'))
    .mockResolvedValueOnce(reply(409, { code: 'revision_conflict', message: 'Still stale' }));
  const { result } = await loaded();
  let caught;
  await act(async () => { try { await result.current.createGuest('Visitor'); } catch (err) { caught = err; } });
  expect(caught).toMatchObject({ message: 'Still stale', status: 409 });
  expect(posts()).toHaveLength(2);
  expect(log.warn).toHaveBeenCalledWith('people.guest.create.failed', expect.objectContaining({ status: 409, attempt: 2 }));
  expect(result.current.people).toEqual([person]);
});

it('does not retry a failure that is not a revision problem', async () => {
  fetchMock
    .mockResolvedValueOnce(reply(200, { people: [person] }, '"3"'))
    .mockResolvedValueOnce(reply(422, { code: 'invalid_guest', message: 'Invalid guest identity' }));
  const { result } = await loaded();
  await act(async () => { await expect(result.current.createGuest('Visitor')).rejects.toMatchObject({ status: 422 }); });
  expect(posts()).toHaveLength(1);
  expect(log.warn).toHaveBeenCalledWith('people.guest.create.failed', expect.objectContaining({ status: 422, attempt: 1 }));
});

it('clears a load error once a later reload succeeds', async () => {
  fetchMock
    .mockResolvedValueOnce(reply(503, { code: 'feature_unavailable', message: 'Down' }))
    .mockResolvedValueOnce(reply(200, { people: [person] }, '"7"'))
    .mockImplementationOnce(async (_url, init) => reply(201, created(JSON.parse(init.body).id), '"8"'));
  const { result } = await loaded();
  expect(result.current.error).toMatchObject({ status: 503 });
  await act(async () => { await result.current.createGuest('Visitor'); });
  expect(result.current.error).toBeNull();
  expect(posts()[0].ifMatch).toBe('"7"');
});
