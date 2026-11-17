import { describe, it, expect, vi } from 'vitest';
import { DaylightAndroidBluetoothAdapter } from './DaylightAndroidBluetoothAdapter.mjs';

const state = { ok: true, adapter: { supported: true, enabled: true, discovering: false }, devices: [], pairing: null, capabilities: { input: true } };

function build({ get = vi.fn(async () => ({ ok: true, data: state })), post = vi.fn(async () => ({ ok: true, data: { ok: true, accepted: true } })) } = {}) {
  return { adapter: new DaylightAndroidBluetoothAdapter({ restClient: { get, post, delete: vi.fn() }, timeoutMs: 4000 }), get, post };
}
const failure = (code, extra = {}) => ({ ok: false, code, error: 'HTTP: pin 1234 was wrong', ...extra });

describe('DaylightAndroidBluetoothAdapter', () => {
  it('requires a rest client', () => {
    expect(() => new DaylightAndroidBluetoothAdapter({})).toThrow(/restClient/);
  });

  it('reads the state from GET /bluetooth', async () => {
    const { adapter, get } = build();
    await expect(adapter.state()).resolves.toEqual(state);
    expect(get).toHaveBeenCalledWith('/bluetooth', { timeout: 4000 });
  });

  it('posts a command to its route with the body', async () => {
    const { adapter, post } = build();
    await expect(adapter.command('connect', { address: 'AA:BB:CC:DD:EE:FF', profile: 'input' }))
      .resolves.toEqual({ ok: true, accepted: true });
    await adapter.command('scan/stop', {});
    expect(post.mock.calls).toEqual([
      ['/bluetooth/connect', { address: 'AA:BB:CC:DD:EE:FF', profile: 'input' }, { timeout: 4000 }],
      ['/bluetooth/scan/stop', {}, { timeout: 4000 }],
    ]);
  });

  it.each([
    ['a state with no adapter', { get: vi.fn(async () => ({ ok: true, data: { ok: true, devices: [] } })) }, 'state'],
    ['a state whose devices are not a list', { get: vi.fn(async () => ({ ok: true, data: { ok: true, adapter: {}, devices: null } })) }, 'state'],
    ['a command answer that was not accepted', { post: vi.fn(async () => ({ ok: true, data: { ok: true } })) }, 'command'],
  ])('rejects %s as an invalid response', async (_label, deps, kind) => {
    const { adapter } = build(deps);
    const call = kind === 'state' ? adapter.state() : adapter.command('scan', { durationMs: 5000 });
    await expect(call).rejects.toMatchObject({ status: 502, message: 'Bluetooth bridge returned an invalid response' });
  });

  it.each([
    ['HTTP 409', failure('COMMAND_REJECTED', { status: 409 }), { status: 409, code: 'bridge_rejected' }],
    ['a body that says action_rejected', failure('COMMAND_REJECTED', { status: 200, deviceCode: 'action_rejected' }), { status: 409, code: 'bridge_rejected' }],
    ['any other refusal', failure('COMMAND_REJECTED', { status: 400 }), { status: 502, code: 'bridge_rejected' }],
    ['a device-side failure', failure('HTTP_ERROR', { status: 500 }), { status: 502, code: 'bridge_rejected' }],
    ['a rejected token', failure('AUTH_REJECTED', { status: 401 }), { status: 502, code: 'auth_rejected' }],
    ['a wrong method (405)', failure('COMMAND_REJECTED', { status: 405, deviceError: 'method_not_allowed' }), { status: 501, code: 'unsupported' }],
    ['an unsupported action (501)', failure('UNSUPPORTED', { status: 501, reason: 'gamepad mode' }), { status: 501, code: 'unsupported' }],
    ['a body that is not JSON', failure('INVALID_RESPONSE'), { status: 502, message: 'Bluetooth bridge returned invalid JSON' }],
    ['a timeout', failure('TIMEOUT'), { status: 504, code: 'timeout' }],
    ['an unreachable device', failure('UNREACHABLE'), { status: 502, code: 'unreachable' }],
  ])('maps %s', async (_label, result, expected) => {
    const { adapter } = build({ get: vi.fn(async () => result), post: vi.fn(async () => result) });
    const stateError = await adapter.state().catch(e => e);
    const commandError = await adapter.command('pair', { address: 'AA:BB:CC:DD:EE:FF' }).catch(e => e);
    for (const error of [stateError, commandError]) {
      expect(error).toMatchObject(expected);
      // Upstream text can hold pairing secrets; none of it reaches the caller.
      expect(error.message).not.toMatch(/1234|pin/i);
    }
  });

  it('turns a thrown client error into unreachable', async () => {
    const { adapter } = build({ get: vi.fn(async () => { throw new Error('boom 1234'); }) });
    const error = await adapter.state().catch(e => e);
    expect(error).toMatchObject({ status: 502, code: 'unreachable' });
    expect(error.message).not.toContain('1234');
  });
});
