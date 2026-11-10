import { describe, it, expect, vi } from 'vitest';
import { createPresenceMiddleware } from './presenceMiddleware.mjs';

const run = async ({ method = 'POST', headers = {}, body = {}, path = '/self-service/resolve', cfg = { presence_hook: { devices: ['portal'] } }, fire = vi.fn().mockResolvedValue({ ok: true }) } = {}) => {
  const mw = createPresenceMiddleware({ presenceHook: { fire }, loadConfig: () => cfg });
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method, path, body, headers: lower, get: (h) => lower[h.toLowerCase()] };
  const next = vi.fn();
  mw(req, {}, next);
  await new Promise((r) => setTimeout(r, 0));
  return { fire, next };
};

describe('presenceMiddleware', () => {
  it('fires once for a POST from a listed device, event = path', async () => {
    const { fire, next } = await run({ headers: { 'X-Daylight-Device': 'portal' } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({ result: 'present', source: 'portal', device: 'portal', event: '/self-service/resolve' });
  });
  it('falls back to body.deviceId', async () => {
    const { fire } = await run({ body: { deviceId: 'portal' } });
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('accepts the fleet: prefixed id', async () => {
    const { fire } = await run({ headers: { 'X-Daylight-Device': 'fleet:portal' } });
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('does not fire for GET', async () => {
    const { fire, next } = await run({ method: 'GET', headers: { 'X-Daylight-Device': 'portal' } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(fire).not.toHaveBeenCalled();
  });
  it('does not fire for an unlisted device', async () => {
    expect((await run({ headers: { 'X-Daylight-Device': 'livingroom-tv' } })).fire).not.toHaveBeenCalled();
  });
  it('does not fire with no device', async () => {
    expect((await run({})).fire).not.toHaveBeenCalled();
  });
  it('does not fire for a test sitting', async () => {
    expect((await run({ headers: { 'X-Daylight-Device': 'portal' }, body: { mode: 'test' } })).fire).not.toHaveBeenCalled();
  });
  it('does not fire when devices is absent', async () => {
    expect((await run({ headers: { 'X-Daylight-Device': 'portal' }, cfg: { presence_hook: { script: 'x' } } })).fire).not.toHaveBeenCalled();
  });
  it.each(['/card-ladder/test/open', '/flashcards/x/heartbeat', '/reading/session/ack'])('does not fire for self-driven %s', async (path) => {
    expect((await run({ headers: { 'X-Daylight-Device': 'portal' }, path })).fire).not.toHaveBeenCalled();
  });
  it('still fires for remote-launch /sessions', async () => {
    expect((await run({ headers: { 'X-Daylight-Device': 'portal' }, path: '/sessions' })).fire).toHaveBeenCalledTimes(1);
  });
  it('a rejecting fire leaves next called once and nothing thrown', async () => {
    const fire = vi.fn().mockRejectedValue(new Error('ha down'));
    const { next } = await run({ headers: { 'X-Daylight-Device': 'portal' }, fire });
    expect(next).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('a synchronously throwing fire is also contained', async () => {
    const fire = vi.fn(() => { throw new Error('boom'); });
    const { next } = await run({ headers: { 'X-Daylight-Device': 'portal' }, fire });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
