import { ownCheckpointBytes, sameProvenance } from './checkpointClient.js';
import { checkpointGameKey } from './checkpointJournal.js';

// Reopening in the same page must wait for an old console's asynchronous exit.
const inPageWrites = new Map();
// If IndexedDB fails before teardown, retain the owned bytes in-page for retry.
const volatileCopies = new Map();
const issue = (message, code) => Object.assign(new Error(message), { code });
function failure(reason) {
  return { status: 'error', code: reason?.code || 'ECHECKPOINTUNAVAILABLE',
    error: reason?.error || reason?.message || 'Could not read or save progress', httpStatus: reason?.httpStatus ?? null };
}
function track(gameKey, promise) {
  const pending = inPageWrites.get(gameKey) ?? new Set();
  pending.add(promise); inPageWrites.set(gameKey, pending);
  const remove = () => { pending.delete(promise); if (!pending.size) inPageWrites.delete(gameKey); };
  promise.then(remove, remove);
  return promise;
}
function forgetVolatile(gameKey, captureId) {
  const copies = volatileCopies.get(gameKey);
  copies?.delete(captureId);
  if (copies && !copies.size) volatileCopies.delete(gameKey);
}
function matchesCapture(record, head) {
  return head && record.captureId === head.captureId && record.sessionId === head.sessionId
    && record.sequence === head.sequence && sameProvenance(record.provenance, head.provenance)
    && ['snapshot', 'battery'].every(name => record.artifacts[name]?.hash === head.artifacts[name]?.hash
      && record.artifacts[name]?.bytes === head.artifacts[name]?.bytes);
}

/** Ordered progress lifecycle. Engine restoration must be acknowledged before writes. */
export function createCheckpointSession({ key, saveMode, client, journal,
  makeId = () => globalThis.crypto.randomUUID(), now = () => Date.now(), onStateChange } = {}) {
  const gameKey = checkpointGameKey(key);
  key = { system: key.system, gameId: key.gameId, user: key.user.toLowerCase() };
  const sessionId = makeId();
  let sequence = 0, phase = 'idle', head = null, description = null, fault = null;
  let restored = false, disposed = false, retrying = false, lastCaptureId = null;
  let pendingRecovery = [], recoveryReason = null;
  let localTail = Promise.resolve(), uploadTail = Promise.resolve({ status: 'ok' });
  const entries = [];
  function getState() {
    const canSave = restored && !disposed && !fault && !retrying && ['ready', 'saving'].includes(phase);
    return { phase, canSave, canPlay: canSave, revision: head?.revision ?? null,
      savedAt: head?.createdAt ?? null, pendingCount: entries.length + pendingRecovery.length,
      error: fault, recoveryReason };
  }
  const publish = () => { if (!disposed) onStateChange?.(getState()); };
  function markFailure(reason) {
    fault = failure(reason); phase = fault.code === 'ECHECKPOINTCONFLICT' ? 'conflict' : 'error';
    publish(); return fault;
  }
  const recover = (reason, pending) => {
    phase = 'recovery'; recoveryReason = reason; pendingRecovery = pending; publish();
    return { status: 'recovery', reason, description, pending };
  };
  function resumePoint() {
    if (!head || head.kind === 'reset') return { kind: 'fresh', data: null, intentionalReset: head?.kind === 'reset' };
    if (head.snapshot) return { kind: 'state', data: head.snapshot };
    if (saveMode === 'battery' && head.battery) return { kind: 'battery', data: head.battery };
    throw issue('The saved checkpoint has no usable resume data', 'ECHECKPOINTCORRUPT');
  }
  async function prepare({ variant = 'wasm' } = {}) {
    if (disposed) return { status: 'skipped' };
    if (entries.length) return markFailure(issue('Finish the pending save before loading again', 'ECHECKPOINTCONFLICT'));
    restored = false; fault = null; phase = 'loading'; publish();
    try {
      await Promise.allSettled([...(inPageWrites.get(gameKey) ?? [])]);
      // Durable-store failure in a previous in-page console cannot erase its RAM copy.
      for (const input of [...(volatileCopies.get(gameKey)?.values() ?? [])]) {
        await journal.put(input); forgetVolatile(gameKey, input.captureId);
      }
      const [remote, records] = await Promise.all([client.getCheckpoint(key, { variant }), journal.list(key)]);
      pendingRecovery = records;
      if (remote.status !== 'ok') return markFailure(remote);
      description = remote.data; head = description.head;
      if (description.saveMode !== saveMode) return markFailure(issue('The save configuration changed; reload the arcade', 'ECHECKPOINTCOMPAT'));
      if (!description.compatible) return recover('compatibility', records);
      const remaining = [];
      for (const record of records) {
        if (record.captureId === head?.captureId) {
          if (!matchesCapture(record, head)) return recover('conflict', records);
          await journal.acknowledge(key, record.captureId, record.fingerprint);
        } else remaining.push(record);
      }
      // Only a unique recorded successor chain may advance this exact head.
      // A different writer/branch is never silently rebased or chosen by date.
      const chain = [];
      let predecessor = head?.captureId ?? null;
      const unvisited = new Map(remaining.map(record => [record.captureId, record]));
      while (unvisited.size) {
        const candidates = [...unvisited.values()].filter(record => record.previousCaptureId === predecessor
          && (predecessor !== null || record.expectedRevision === (head?.revision ?? null)));
        if (candidates.length !== 1) return recover('conflict', remaining);
        const record = candidates[0];
        if (record.saveMode !== saveMode || !sameProvenance(record.provenance, description.provenance)) return recover('compatibility', remaining);
        chain.push(record); unvisited.delete(record.captureId); predecessor = record.captureId;
      }
      for (const record of chain) {
        const result = await client.putCheckpoint(key, { ...record, expectedRevision: head?.revision ?? null });
        if (result.status !== 'ok') return markFailure(result);
        head = result.data.head;
        await journal.acknowledge(key, record.captureId, record.fingerprint);
      }
      pendingRecovery = []; description = { ...description, head };
      lastCaptureId = head?.captureId ?? null; phase = 'restoring'; publish();
      const resume = resumePoint();
      const artifactHash = resume.kind === 'fresh' ? null : head.artifacts[resume.kind === 'state' ? 'snapshot' : 'battery'].hash;
      return { status: 'ready', head, provenance: description.provenance, saveMode, resume, artifactHash };
    } catch (reason) { return markFailure(reason); }
  }
  function confirmRestored(result) {
    const expectedHash = head?.snapshot ? head.artifacts.snapshot.hash : head?.battery ? head.artifacts.battery.hash : null;
    if ((result?.artifactHash ?? null) !== expectedHash || phase !== 'restoring' || result?.status !== 'ok' || result.verified !== true
      || !sameProvenance(result.provenance, description?.provenance)) {
      return markFailure(issue('Saved progress was not verified by the emulator', 'ECHECKPOINTRESTORE'));
    }
    restored = true; phase = 'ready'; publish(); return { status: 'ok' };
  }
  function stage(captured) {
    const snapshot = ownCheckpointBytes(captured?.state ?? captured?.snapshot);
    const battery = saveMode === 'battery' ? ownCheckpointBytes(captured?.battery) : null;
    if (!snapshot || (saveMode === 'battery' && !battery)) throw issue('Required game progress was not captured', 'ECHECKPOINTINVALID');
    const input = { key, saveMode, snapshot, battery, expectedRevision: head?.revision ?? null,
      previousCaptureId: lastCaptureId, sessionId, sequence: ++sequence, captureId: makeId(),
      createdAt: now(), provenance: description.provenance };
    const copies = volatileCopies.get(gameKey) ?? new Map();
    if (copies.has(input.captureId)) throw issue('A recovery capture identity was reused', 'ECHECKPOINTJOURNALCONFLICT');
    copies.set(input.captureId, input); volatileCopies.set(gameKey, copies);
    const entry = { input, record: null };
    entries.push(entry); lastCaptureId = input.captureId;
    entry.local = localTail.then(async () => {
      try {
        entry.record = await journal.put(input); forgetVolatile(gameKey, input.captureId);
        return entry.record;
      } catch (reason) { markFailure(reason); return null; }
    });
    localTail = entry.local;
    return entry;
  }
  async function upload(entry) {
    if (!entry.record) await entry.local;
    if (fault) return fault;
    if (!entry.record) return markFailure(issue('Local progress is not durable', 'ECHECKPOINTJOURNALUNAVAILABLE'));
    if (matchesCapture(entry.record, head)) {
      // The server may have committed before local cleanup failed. This is the
      // same acknowledged capture, not a new parent or a branch to rebase.
      await journal.acknowledge(key, entry.record.captureId, entry.record.fingerprint);
      entries.splice(entries.indexOf(entry), 1);
      if (!fault && !retrying && !disposed) phase = entries.length ? 'saving' : 'ready';
      publish(); return { status: 'ok', data: { head } };
    }
    const previous = head?.captureId ?? null;
    if (entry.record.previousCaptureId !== previous
      || (previous === null && entry.record.expectedRevision !== (head?.revision ?? null))) {
      return markFailure(issue('The pending capture belongs to a different progress branch', 'ECHECKPOINTCONFLICT'));
    }
    const result = await client.putCheckpoint(key, { ...entry.record, expectedRevision: head?.revision ?? null });
    if (result.status !== 'ok') return markFailure(result);
    head = result.data.head;
    await journal.acknowledge(key, entry.record.captureId, entry.record.fingerprint);
    entries.splice(entries.indexOf(entry), 1);
    if (!fault && !retrying && !disposed) phase = entries.length ? 'saving' : 'ready';
    publish(); return { status: 'ok', data: { head } };
  }
  function save(captured) {
    if (!getState().canSave) return Promise.resolve({ status: 'skipped', reason: 'resume-not-verified-or-saving-blocked' });
    let entry;
    try { entry = stage(captured); }
    catch (reason) { return Promise.resolve(markFailure(reason)); }
    phase = 'saving'; publish();
    const next = uploadTail.then(() => upload(entry)).catch(markFailure);
    uploadTail = next;
    return track(gameKey, next);
  }
  function retry(captured) {
    if (!restored || disposed) return Promise.resolve({ status: 'skipped' });
    if (retrying) return uploadTail;
    if (captured) {
      try { stage(captured); } catch (reason) { return Promise.resolve(markFailure(reason)); }
    }
    const previousUpload = uploadTail;
    retrying = true; publish();
    const next = (async () => {
      await previousUpload;
      await localTail;
      fault = null; phase = 'saving'; publish();
      try {
        for (const entry of [...entries]) {
          if (!entry.record) {
            entry.record = await journal.put(entry.input);
            forgetVolatile(gameKey, entry.input.captureId);
          }
          const result = await upload(entry);
          if (result.status !== 'ok') return result;
        }
        return { status: 'ok', data: { head } };
      } catch (reason) { return markFailure(reason); }
      finally {
        retrying = false;
        if (!fault && !disposed) phase = 'ready';
        publish();
      }
    })();
    uploadTail = next;
    return track(gameKey, next);
  }
  return { prepare, confirmRestored, save, retry, getState,
    flush: captured => captured ? save(captured) : uploadTail.then(result => fault || result),
    getRecovery: () => ({ description, pending: pendingRecovery }),
    dispose() { disposed = true; phase = 'disposed'; },
  };
}
