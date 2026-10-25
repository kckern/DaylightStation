import { checkpointDigest, ownCheckpointBytes, validProvenance } from './checkpointClient.js';

const fail = message => Object.assign(new Error(message), { code: 'ECHECKPOINTRESTORE' });

/** Own and hash the actual boot inputs; EJS caches must never substitute them. */
export async function prepareProtectedAssets({ provenance, romUrl, pathtodata,
  fetchImpl = (...args) => globalThis.fetch(...args), cryptoImpl = globalThis.crypto,
  win = globalThis, timeoutMs = 60000 } = {}) {
  if (!validProvenance(provenance) || provenance.core.format !== 1) throw fail('Unsupported checkpoint core');
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(fail('Game verification timed out')); controller.abort(); }, timeoutMs);
  });
  const read = async (url, expected) => {
    const response = await Promise.race([fetchImpl(url, { cache: 'no-store', signal: controller.signal }), deadline]);
    if (!response?.ok) throw fail('Could not verify game assets');
    const bytes = new Uint8Array(await Promise.race([response.arrayBuffer(), deadline]));
    if (!bytes.length || await checkpointDigest(bytes, cryptoImpl) !== expected) throw fail('Game or core bytes changed; hash does not match');
    return bytes;
  };
  try {
    const core = provenance.core;
    const path = pathtodata.endsWith('/') ? pathtodata : `${pathtodata}/`;
    const [rom, bundle] = await Promise.all([
      read(romUrl, provenance.romHash),
      read(`${path}cores/${core.name}-${core.variant}.protected-v1.data`, core.bundleHash),
    ]);
    const bundleUrl = win.URL.createObjectURL(new win.Blob([bundle]));
    return {
      romFile: new win.File([rom], 'verified-game.rom'), provenance,
      // If EJS selects a different GL setting, it still cannot load different
      // bytes. An unsupported GL mode fails boot instead of changing provenance.
      paths: { [`${core.name}-wasm.data`]: bundleUrl, [`${core.name}-legacy-wasm.data`]: bundleUrl },
      dispose() { win.URL.revokeObjectURL(bundleUrl); },
    };
  } finally { clearTimeout(timer); controller.abort(); }
}

/** The protected native RPC runs synchronously while paused, with no game frame. */
export function createNativeCheckpointBridge({ instance, provenance, cryptoImpl = globalThis.crypto } = {}) {
  const gm = instance?.gameManager, module = gm?.Module;
  if (!validProvenance(provenance) || provenance.core.format !== 1
    || instance?.getCore?.() !== provenance.core.name
    || module?._daylight_checkpoint_contract_version?.() !== 1) throw fail('This emulator cannot verify saved progress');
  instance.pause();
  gm.clearEJSResetTimer();
  if (module._daylight_enable_checkpoint_protection_v1() !== 1) throw fail('A previous load is still pending');
  let nextRequest = 0;
  const state = module.cwrap('daylight_restore_state_v1', 'number', ['string', 'number']);
  const battery = module.cwrap('daylight_restore_battery_v1', 'number', ['string', 'number']);
  return {
    async restore(resume) {
      let path;
      try {
        instance.pause(); gm.clearEJSResetTimer();
        if (resume?.kind === 'fresh') return { status: 'ok', verified: true, provenance, artifactHash: null, requestId: 0 };
        if (!['state', 'battery'].includes(resume?.kind)) throw fail('Unknown restore kind');
        const bytes = ownCheckpointBytes(resume.data);
        const artifactHash = await checkpointDigest(bytes, cryptoImpl);
        const requestId = ++nextRequest;
        if (requestId > 0xffffffff) throw fail('Restore request limit reached');
        path = resume.kind === 'state' ? '/daylight-checkpoint-restore.state' : gm.getSaveFilePath();
        gm.FS.writeFile(path, bytes);
        const result = (resume.kind === 'state' ? state : battery)(path, requestId);
        if (result !== 1 || module._daylight_restore_last_request_v1() !== requestId) throw fail('Saved progress was not restored; existing saves are protected');
        return { status: 'ok', verified: true, provenance, artifactHash, requestId };
      } catch (error) {
        return { status: 'error', code: error.code || 'ECHECKPOINTRESTORE', error: error.message };
      } finally {
        if (path) { try { gm.FS.unlink(path); } catch { /* MEMFS scratch cleanup only */ } }
      }
    },
  };
}
