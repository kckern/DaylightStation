import { ownCheckpointBytes, checkpointDigest, validProvenance } from './checkpointClient.js';

const STORE = 'captures';
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const id = value => typeof value === 'string' && ID.test(value);
const issue = (message, code = 'ECHECKPOINTINVALID') => Object.assign(new Error(message), { code });
const unavailable = error => error?.code?.startsWith?.('ECHECKPOINT') ? error
  : issue(error?.message || 'The local recovery journal is unavailable', 'ECHECKPOINTJOURNALUNAVAILABLE');
export function checkpointGameKey(key) {
  if (!key || ![key.system, key.gameId, key.user].every(id)) throw issue('Invalid recovery identity');
  return JSON.stringify([key.system, key.gameId, key.user.toLowerCase()]);
}

/** Own and seal all bytes/metadata before any asynchronous persistence/upload. */
export async function sealCheckpointCapture(input, { cryptoImpl = globalThis.crypto } = {}) {
  const gameKey = checkpointGameKey(input.key);
  if (!id(input.captureId) || !id(input.sessionId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || (input.expectedRevision !== null && !id(input.expectedRevision))
    || (input.previousCaptureId != null && !id(input.previousCaptureId))
    || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0
    || !['state', 'battery'].includes(input.saveMode) || !validProvenance(input.provenance)) throw issue('Invalid recovery capture metadata');
  const snapshot = ownCheckpointBytes(input.snapshot);
  const battery = ownCheckpointBytes(input.battery);
  if (!snapshot || (input.saveMode === 'battery' ? !battery : !!battery)) throw issue('Required game progress was not captured');
  const core = input.provenance.core;
  const metadata = { schema: 1, gameKey, key: { system: input.key.system, gameId: input.key.gameId, user: input.key.user.toLowerCase() },
    captureId: input.captureId, sessionId: input.sessionId, sequence: input.sequence,
    expectedRevision: input.expectedRevision, previousCaptureId: input.previousCaptureId ?? null,
    createdAt: input.createdAt, saveMode: input.saveMode,
    provenance: { romHash: input.provenance.romHash, core: { name: core.name, bundleHash: core.bundleHash, format: core.format, variant: core.variant } },
  };
  const artifacts = { snapshot: { hash: await checkpointDigest(snapshot, cryptoImpl), bytes: snapshot.length },
    battery: battery ? { hash: await checkpointDigest(battery, cryptoImpl), bytes: battery.length } : null };
  const fingerprint = await checkpointDigest(new TextEncoder().encode(JSON.stringify({ ...metadata, artifacts })), cryptoImpl);
  if (input.fingerprint !== undefined && input.fingerprint !== fingerprint) throw issue('The recovery copy failed its integrity check', 'ECHECKPOINTCORRUPT');
  return { ...metadata, artifacts, fingerprint, snapshot, battery };
}

/** Durable per-capture IndexedDB journal. Storage failure must never look like success. */
export function createCheckpointJournal({ indexedDB: databaseApi = globalThis.indexedDB,
  name = 'daylight-emulator-progress-v1', cryptoImpl = globalThis.crypto } = {}) {
  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!databaseApi) return reject(issue('Local recovery storage is unavailable', 'ECHECKPOINTJOURNALUNAVAILABLE'));
      let blocked = false;
      const request = databaseApi.open(name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: ['gameKey', 'captureId'] });
        store.createIndex('game', 'gameKey', { unique: false });
      };
      request.onblocked = () => { blocked = true; reject(issue('Another page is blocking recovery storage', 'ECHECKPOINTJOURNALUNAVAILABLE')); };
      request.onerror = () => reject(unavailable(request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw unavailable(error); });
    return opening;
  }
  async function execute(mode, work) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        // Strict durability waits for the browser's durable transaction commit.
        const tx = mode === 'readwrite' ? db.transaction(STORE, mode, { durability: 'strict' }) : db.transaction(STORE, mode);
        let result, error;
        const fail = reason => { error = reason; tx.abort(); };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(unavailable(error || tx.error));
        tx.onerror = () => { error ||= tx.error; };
        try { work(tx.objectStore(STORE), { fail, done: value => { result = value; } }); }
        catch (reason) { fail(reason); }
      });
    } catch (error) { throw unavailable(error); }
  }
  return {
    async put(input) {
      const record = await sealCheckpointCapture(input, { cryptoImpl });
      return execute('readwrite', (store, { fail, done }) => {
        const existing = store.get([record.gameKey, record.captureId]);
        existing.onsuccess = () => {
          if (existing.result && existing.result.fingerprint !== record.fingerprint) {
            fail(issue('Another recovery capture already uses this identity', 'ECHECKPOINTJOURNALCONFLICT')); return;
          }
          if (!existing.result) store.add(record);
          done(record);
        };
      });
    },
    async list(key) {
      const gameKey = checkpointGameKey(key);
      const records = await execute('readonly', (store, { done }) => {
        const request = store.index('game').getAll(gameKey);
        request.onsuccess = () => done(request.result);
      });
      const verified = [];
      for (const record of records) {
        if (record.schema !== 1 || typeof record.fingerprint !== 'string' || record.gameKey !== gameKey) throw issue('Invalid recovery journal data', 'ECHECKPOINTCORRUPT');
        verified.push(await sealCheckpointCapture(record, { cryptoImpl }));
      }
      return verified.sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence);
    },
    async acknowledge(key, captureId, fingerprint) {
      const gameKey = checkpointGameKey(key);
      return execute('readwrite', (store, { fail, done }) => {
        const request = store.get([gameKey, captureId]);
        request.onsuccess = () => {
          const record = request.result;
          if (!record) { done(false); return; }
          if (record.fingerprint !== fingerprint) {
            fail(issue('The acknowledgment belongs to a different recovery capture', 'ECHECKPOINTJOURNALCONFLICT')); return;
          }
          store.delete([gameKey, captureId]);
          done(true);
        };
      });
    },
  };
}
