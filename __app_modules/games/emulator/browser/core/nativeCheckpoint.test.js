import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { checkpointDigest } from './checkpointClient.js';
import { createNativeCheckpointBridge, prepareProtectedAssets, selectCheckpointVariant } from './nativeCheckpoint.js';

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
async function provenance() {
  return { romHash: await checkpointDigest(bytes, webcrypto), core: {
    name: 'gambatte', bundleHash: await checkpointDigest(bytes, webcrypto), variant: 'wasm', format: 1,
  } };
}
function native({ result = 1, echo = true } = {}) {
  let lastId = 0;
  const restore = vi.fn((path, id) => { lastId = echo ? id : id + 1; return result; });
  const Module = {
    _daylight_checkpoint_contract_version: () => 1,
    _daylight_enable_checkpoint_protection_v1: () => 1,
    _daylight_restore_last_request_v1: () => lastId,
    cwrap: () => restore,
  };
  const instance = { pause: vi.fn(), getCore: () => 'gambatte',
    gameManager: { Module, clearEJSResetTimer: vi.fn(), FS: { writeFile: vi.fn(), unlink: vi.fn() }, getSaveFilePath: () => '/game.srm' } };
  return { instance, restore };
}
describe('verified native completion', () => {
  it('holds gameplay, cancels the late reset and binds the actual native result to artifact and request', async () => {
    const { instance, restore } = native(); const p = await provenance();
    const bridge = createNativeCheckpointBridge({ instance, provenance: p, cryptoImpl: webcrypto });
    const proof = await bridge.restore({ kind: 'state', data: bytes });
    expect(instance.pause).toHaveBeenCalled(); expect(instance.gameManager.clearEJSResetTimer).toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(expect.any(String), proof.requestId);
    expect(proof).toMatchObject({ status: 'ok', verified: true, provenance: p, artifactHash: p.romHash });
  });
  it.each([{ result: 0 }, { echo: false }])('rejects native failure or mismatched completion identity %j', async options => {
    const { instance } = native(options);
    const bridge = createNativeCheckpointBridge({ instance, provenance: await provenance(), cryptoImpl: webcrypto });
    expect(await bridge.restore({ kind: 'state', data: bytes })).toMatchObject({ status: 'error' });
  });
  it('rejects stock wrappers and a different loaded core before accepting a fresh boot', async () => {
    const p = await provenance(), { instance } = native();
    delete instance.gameManager.Module._daylight_checkpoint_contract_version;
    expect(() => createNativeCheckpointBridge({ instance, provenance: p })).toThrow();
    const wrong = native().instance; wrong.getCore = () => 'mgba';
    expect(() => createNativeCheckpointBridge({ instance: wrong, provenance: p })).toThrow();
  });
});
describe('actual boot asset verification', () => {
  it('supplies owned verified ROM/core bytes and revokes its blob on teardown', async () => {
    const p = await provenance(), createObjectURL = vi.fn(() => 'blob:verified'), revokeObjectURL = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer }));
    const assets = await prepareProtectedAssets({ provenance: p, romUrl: '/rom', pathtodata: '/engine/', fetchImpl,
      cryptoImpl: webcrypto, win: { File, Blob, URL: { createObjectURL, revokeObjectURL } } });
    expect(assets.romFile).toBeInstanceOf(File);
    expect(new Uint8Array(await assets.romFile.arrayBuffer())).toEqual(bytes);
    expect(assets.paths['gambatte-wasm.data']).toBe('blob:verified');
    expect(fetchImpl).toHaveBeenCalledWith('/engine/cores/gambatte-wasm.protected-v1.data', expect.objectContaining({ cache: 'no-store' }));
    assets.dispose(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:verified');
  });
  it('rejects changed/cached bytes without issuing boot assets', async () => {
    await expect(prepareProtectedAssets({ provenance: await provenance(), romUrl: '/rom', pathtodata: '/engine/', cryptoImpl: webcrypto,
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer }) })).rejects.toThrow(/changed|hash|match/i);
  });
});


it('selects a supported native variant before reading progress and honors an explicit legacy selection', () => {
  const probe = vi.fn(() => ({})), win = { document: { createElement: () => ({ getContext: probe }) } };
  expect(selectCheckpointVariant({ win })).toBe('wasm');
  probe.mockReturnValue(null); expect(selectCheckpointVariant({ win })).toBe('legacy-wasm');
  probe.mockClear(); expect(selectCheckpointVariant({ win, preferred: 'legacy-wasm' })).toBe('legacy-wasm'); expect(probe).not.toHaveBeenCalled();
});
