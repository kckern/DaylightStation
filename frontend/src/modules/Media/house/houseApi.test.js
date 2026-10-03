import { describe, it, expect, vi, beforeEach } from 'vitest';
import { houseApi, HouseApiError, screenIdFor } from './houseApi.js';

function respond(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('houseApi', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  it('maps a fleet device id to its registry screen id and leaves screen ids alone', () => {
    expect(screenIdFor('livingroom-tv')).toBe('fleet:livingroom-tv');
    expect(screenIdFor('browser:abc')).toBe('browser:abc');
    expect(screenIdFor('fleet:office-tv')).toBe('fleet:office-tv');
    expect(screenIdFor('screen:den')).toBe('screen:den');
    expect(screenIdFor('')).toBe(null);
  });

  it('sends the rename with confirm and encodes the screen id in the path', async () => {
    fetchMock.mockReturnValue(respond(200, { screen: { id: 'browser:a', name: 'Poo' }, routines: [] }));
    const result = await houseApi.renameScreen('browser:a', { name: 'Poo', confirm: true });
    expect(result.screen.name).toBe('Poo');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/media\/screens\/browser%3Aa$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: 'Poo', confirm: true });
  });

  it('keeps the whole error body (code, suggestion, routines) on a 409', async () => {
    const routines = Array.from({ length: 12 }, (_, i) => ({ id: `automation:r${i}`, name: `Routine number ${i} with a long name` }));
    fetchMock.mockReturnValue(respond(409, { error: 'routines', code: 'ROUTINES_TARGET', routines }));
    const error = await houseApi.renameScreen('fleet:livingroom-tv', { name: 'Den' }).catch((e) => e);
    expect(error).toBeInstanceOf(HouseApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('ROUTINES_TARGET');
    expect(error.details.routines).toHaveLength(12);
  });

  it('reports a network failure as a transient error without a code', async () => {
    fetchMock.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));
    const error = await houseApi.listScreens().catch((e) => e);
    expect(error).toBeInstanceOf(HouseApiError);
    expect(error.transient).toBe(true);
    expect(error.code).toBe(null);
  });

  it('asks for start status and turns a screen off through the device API', async () => {
    fetchMock.mockReturnValueOnce(respond(200, { ok: true, status: { phase: 'failed' } }));
    fetchMock.mockReturnValueOnce(respond(200, { ok: true }));
    expect((await houseApi.startStatus('office-tv')).status.phase).toBe('failed');
    await houseApi.screenOff('office-tv');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/device\/office-tv\/start-status$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/v1\/device\/office-tv\/off$/);
  });
});
