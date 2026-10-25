const BASE = '/api/v1/emulator';
const MAX_BYTES = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const id = value => typeof value === 'string' && ID.test(value);
const failure = (message, code = 'ECHECKPOINTCORRUPT') => Object.assign(new Error(message), { code });
const sameBytes = (a, b) => a === b || (a != null && b != null && a.length === b.length && a.every((v, i) => v === b[i]));
export function validProvenance(value) {
  return value && HASH.test(value.romHash) && id(value.core?.name) && HASH.test(value.core?.bundleHash)
    && Number.isSafeInteger(value.core.format) && value.core.format >= 1
    && ['wasm', 'legacy-wasm'].includes(value.core.variant);
}
export function sameProvenance(a, b) {
  return validProvenance(a) && validProvenance(b) && a.romHash === b.romHash
    && a.core.name === b.core.name && a.core.bundleHash === b.core.bundleHash
    && a.core.format === b.core.format && a.core.variant === b.core.variant;
}
export function ownCheckpointBytes(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  if (!(value instanceof Uint8Array) || !value.length || value.length > MAX_BYTES) throw failure('Invalid captured save data', 'ECHECKPOINTINVALID');
  return new Uint8Array(value);
}
export async function checkpointDigest(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) throw failure('Secure save verification is unavailable', 'ECHECKPOINTUNAVAILABLE');
  const hash = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  if (!bytes) return null;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return globalThis.btoa(chunks.join(''));
}
function unbase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4) throw failure('Invalid saved data encoding');
  let binary;
  try { binary = globalThis.atob(value); } catch { throw failure('Invalid saved data encoding'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_BYTES || base64(bytes) !== value) throw failure('Invalid saved data encoding');
  return bytes;
}

/** Versioned checkpoint transport; absence is represented only by a valid 200/head:null. */
export function createCheckpointClient({ fetchImpl = (...args) => globalThis.fetch(...args), baseUrl = BASE,
  logger, timeoutMs = 10000, cryptoImpl = globalThis.crypto } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Checkpoint request timeout must be positive');
  const url = (key, suffix = '') => `${baseUrl}/checkpoint/${encodeURIComponent(key.system)}/${encodeURIComponent(key.gameId)}${suffix}?user=${encodeURIComponent(key.user)}`;
  async function request(address, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = failure('Saving timed out; your recovery copy is retained', 'ECHECKPOINTTIMEOUT');
        reject(error); controller.abort(error);
      }, timeoutMs);
    });
    try {
      const options = { method, cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      };
      const response = await Promise.race([Promise.resolve().then(() => fetchImpl(address, options)), deadline]);
      if (!response) throw failure('No save server response', 'ECHECKPOINTUNAVAILABLE');
      let data;
      try { data = await Promise.race([response.json(), deadline]); }
      catch (err) { if (err.code === 'ECHECKPOINTTIMEOUT') throw err; throw failure('Unreadable save server response', 'ECHECKPOINTUNAVAILABLE'); }
      if (!response.ok) return { status: 'error', httpStatus: response.status,
        code: data?.code || 'ECHECKPOINTUNAVAILABLE', error: data?.error || 'Could not read or save progress' };
      return { status: 'ok', data };
    } catch (err) {
      return { status: 'error', httpStatus: null, code: err.code || 'ECHECKPOINTUNAVAILABLE', error: err.message };
    } finally { clearTimeout(timer); }
  }
  async function verifyHead(key, head) {
    if (!head || head.schema !== 1 || !id(head.revision) || !id(head.captureId) || !id(head.sessionId)
      || !Number.isSafeInteger(head.sequence) || head.sequence < 0 || !validProvenance(head.provenance)
      || !['save', 'baseline', 'import', 'reset', 'recover'].includes(head.kind)
      || head.key?.system !== key.system || head.key?.gameId !== key.gameId
      || head.key?.user !== String(key.user).toLowerCase()
      || !head.artifacts || (head.parent !== null && (!head.parent || !id(head.parent.revision)))) throw failure('Saved progress identity or metadata is invalid');
    const decoded = {};
    for (const name of ['snapshot', 'battery']) {
      const descriptor = head.artifacts[name];
      if (descriptor === null) {
        if (head[name] !== null) throw failure('Saved progress has unexpected data');
        decoded[name] = null;
      } else {
        if (!descriptor || !HASH.test(descriptor.hash) || !Number.isSafeInteger(descriptor.bytes)) throw failure('Saved progress integrity data is invalid');
        const bytes = unbase64(head[name]);
        if (bytes.length !== descriptor.bytes || await checkpointDigest(bytes, cryptoImpl) !== descriptor.hash) throw failure('Saved progress failed its integrity check');
        decoded[name] = bytes;
      }
    }
    if (head.kind === 'reset' ? !!(decoded.snapshot || decoded.battery) : !(decoded.snapshot || decoded.battery)) throw failure('Saved progress is incomplete');
    return { ...head, ...decoded };
  }
  async function protect(operation) {
    let result;
    try { result = await operation(); }
    catch (err) { result = { status: 'error', httpStatus: null, code: err.code || 'ECHECKPOINTUNAVAILABLE', error: err.message }; }
    if (result.status === 'error') logger?.warn?.('emulator.checkpoint.client-failed', { code: result.code, httpStatus: result.httpStatus, error: result.error });
    return result;
  }
  const write = (key, capture, operation) => protect(async () => {
    const snapshot = ['reset', 'recover'].includes(operation) ? null : ownCheckpointBytes(capture.snapshot);
    const battery = ['reset', 'recover'].includes(operation) ? null : ownCheckpointBytes(capture.battery);
    const metadata = { expectedRevision: capture.expectedRevision, captureId: capture.captureId,
      sessionId: capture.sessionId, sequence: capture.sequence, provenance: capture.provenance,
      ...(operation === 'recover' ? { sourceRevision: capture.sourceRevision } : {}),
      ...(!['reset', 'recover'].includes(operation) ? { snapshot: base64(snapshot), battery: base64(battery) } : {}),
    };
    const suffix = operation === 'commit' ? '' : `/${operation}`;
    const result = await request(url(key, suffix), { method: operation === 'commit' ? 'PUT' : 'POST', body: metadata });
    if (result.status !== 'ok') return result;
    const head = await verifyHead(key, result.data.head);
    if (head.captureId !== capture.captureId || head.sessionId !== capture.sessionId || head.sequence !== capture.sequence
      || (head.parent?.revision ?? null) !== capture.expectedRevision || !sameProvenance(head.provenance, capture.provenance)
      || (!['reset', 'recover'].includes(operation) && (!sameBytes(head.snapshot, snapshot) || !sameBytes(head.battery, battery)))) throw failure('The save acknowledgment did not match this capture');
    return { status: 'ok', data: { head } };
  });
  return {
    getCheckpoint: (key, { variant = 'wasm' } = {}) => protect(async () => {
      const result = await request(variant === 'wasm' ? url(key) : `${url(key)}&variant=${encodeURIComponent(variant)}`);
      if (result.status !== 'ok') return result;
      const description = result.data;
      if (!description || !validProvenance(description.provenance) || !['state', 'battery'].includes(description.saveMode)
        || typeof description.compatible !== 'boolean' || description.head === undefined) throw failure('Invalid progress description');
      const head = description.head === null ? null : await verifyHead(key, description.head);
      if (head && description.compatible && !sameProvenance(head.provenance, description.provenance)) throw failure('Saved progress belongs to a different game or core');
      return { status: 'ok', data: { ...description, head } };
    }),
    putCheckpoint: (key, captured) => write(key, captured, 'commit'),
    importCheckpoint: (key, captured) => write(key, captured, 'import'),
    resetCheckpoint: (key, captured) => write(key, captured, 'reset'),
    recoverCheckpoint: (key, captured) => write(key, captured, 'recover'),
    getCheckpointHistory: (key) => protect(async () => {
      const result = await request(url(key, '/history'));
      if (result.status === 'ok' && !Array.isArray(result.data?.checkpoints)) throw failure('Invalid recovery history');
      return result;
    }),
    getCheckpointRevision: (key, revision) => protect(async () => {
      const result = await request(url(key, `/revision/${encodeURIComponent(revision)}`));
      if (result.status !== 'ok') return result;
      const head = await verifyHead(key, result.data.head);
      if (head.revision !== revision) throw failure('The selected recovery point was not returned');
      return { status: 'ok', data: { head } };
    }),
  };
}
