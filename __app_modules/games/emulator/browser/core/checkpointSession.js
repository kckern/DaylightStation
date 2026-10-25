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
  let pendingRecovery = [], recoveryReason = null, recoveryInspection = null, selection = null, recoveryReset = null;
  let localTail = Promise.resolve(), uploadTail = Promise.resolve({ status: 'ok' });
  const entries = [];
  function getState() {
    const canSave = restored && !selection && !disposed && !fault && !retrying && ['ready', 'saving'].includes(phase);
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
    restored = false; selection = null; fault = null; phase = 'loading'; publish();
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
        if (record.requiresRestoreVerification) return recover('verification', remaining);
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
    if (selection || (result?.artifactHash ?? null) !== expectedHash || phase !== 'restoring' || result?.status !== 'ok' || result.verified !== true
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
  async function inspectRecovery({ captured, variant = 'wasm' } = {}) {
    if (disposed) return { status: 'skipped' };
    const wasRestored = restored;
    restored = false; phase = 'recovery'; selection = null; recoveryReset = null; publish();
    try {
      await uploadTail; await localTail;
      if (captured && wasRestored) { const entry = stage(captured); await entry.local; }
      // A failed local write retains its owned input until storage recovers.
      for (const entry of entries) if (!entry.record) {
        entry.record = await journal.put(entry.input); forgetVolatile(gameKey, entry.input.captureId);
      }
      const [remote, pending, archived] = await Promise.all([
        client.getRecoveryInspection(key, { variant }), journal.list(key), journal.listArchived(key),
      ]);
      if (remote.status !== 'ok') return markFailure(remote);
      if (remote.data.saveMode !== saveMode) throw issue('The save configuration changed', 'ECHECKPOINTCOMPAT');
      recoveryInspection = remote.data; pendingRecovery = pending;
      description = { provenance: remote.data.provenance, saveMode, head: remote.data.head };
      fault = null; phase = 'recovery'; publish();
      return { status: 'ok', inspection: recoveryInspection, pending, archived };
    } catch (reason) { return markFailure(reason); }
  }
  async function selectRecovery(choice) {
    if (disposed) return { status: 'skipped' };
    if (!recoveryInspection) return markFailure(issue('Inspect recovery copies first', 'ECHECKPOINTINVALID'));
    restored = false; fault = null;
    try {
      let source;
      if (choice.type === 'server') {
        const result = await client.getRecoveryRevision(key, choice.revision);
        if (result.status !== 'ok') return markFailure(result);
        source = result.data.head;
      } else if (choice.type === 'local') {
        const records = [...await journal.list(key), ...await journal.listArchived(key)];
        source = records.find(record => record.captureId === choice.captureId);
        if (!source) throw issue('That local recovery copy is unavailable', 'ECHECKPOINTINVALID');
      } else throw issue('Choose a recovery copy explicitly', 'ECHECKPOINTINVALID');
      if (source.provenance.romHash !== recoveryInspection.provenance.romHash) throw issue('This recovery copy belongs to a different game', 'ECHECKPOINTCOMPAT');
      source = { ...source, snapshot: ownCheckpointBytes(source.snapshot), battery: ownCheckpointBytes(source.battery) };
      const kind = source.kind === 'reset' ? 'fresh' : source.snapshot ? 'state' : source.battery ? 'battery' : null;
      if (!kind) throw issue('That recovery copy has no saved progress', 'ECHECKPOINTCORRUPT');
      const artifactHash = kind === 'fresh' ? null : source.artifacts[kind === 'state' ? 'snapshot' : 'battery'].hash;
      selection = { choice: { ...choice }, source, artifactHash, inspection: recoveryInspection, pending: [...pendingRecovery] };
      phase = 'restoring'; publish();
      return { status: 'ready', recovery: true, provenance: recoveryInspection.provenance, saveMode, artifactHash,
        resume: { kind, data: kind === 'fresh' ? null : ownCheckpointBytes(kind === 'state' ? source.snapshot : source.battery), intentionalReset: kind === 'fresh' } };
    } catch (reason) { return markFailure(reason); }
  }
  function confirmRecoveryRestored(proof) {
    const work = async () => {
      if (disposed) return { status: 'skipped' };
      const selected = selection;
      if (!selected || proof?.status !== 'ok' || proof.verified !== true
        || (proof.artifactHash ?? null) !== selected.artifactHash
        || !sameProvenance(proof.provenance, selected.inspection.provenance)) {
        return markFailure(issue('The selected progress was not restored by the emulator', 'ECHECKPOINTRESTORE'));
      }
      phase = 'saving'; fault = null; publish();
      try {
        if (!selected.payload) selected.payload = {
          expectedRevision: selected.inspection.currentRevision,
          expectedHeadToken: selected.inspection.headToken,
          sourceRevision: selected.choice.type === 'server' ? selected.source.revision : null,
          intent: selected.choice.type === 'local' ? 'import' : 'recover',
          captureId: makeId(), sessionId, sequence: ++sequence, provenance: selected.inspection.provenance,
          snapshot: selected.source.snapshot, battery: selected.source.battery,
        };
        if (!selected.acknowledgedHead) {
          const operation = selected.inspection.requiresRepair ? 'repairCheckpoint'
            : selected.choice.type === 'server' ? 'recoverCheckpoint' : 'importCheckpoint';
          const result = await client[operation](key, selected.payload);
          if (result.status !== 'ok') return markFailure(result);
          selected.acknowledgedHead = result.data.head;
        }
        // Archive only the branches that were actually shown in this decision.
        // A branch arriving later remains active and blocks play for a new choice.
        await journal.archive(key, selected.pending);
        const remaining = await journal.list(key);
        if (remaining.length) return recover('conflict', remaining);
        head = selected.acknowledgedHead; description = { provenance: selected.inspection.provenance, saveMode, head };
        entries.length = 0; pendingRecovery = []; lastCaptureId = head.captureId;
        selection = null; recoveryReason = null; fault = null; restored = true; phase = 'ready'; publish();
        return { status: 'ok', data: { head } };
      } catch (reason) { return markFailure(reason); }
    };
    return track(gameKey, work());
  }
  function prepareClaim(captured, { variant = 'wasm', claimId, allowExisting = false } = {}) {
    let snapshot, battery;
    try {
      snapshot = ownCheckpointBytes(captured?.state ?? captured?.snapshot);
      battery = saveMode === 'battery' ? ownCheckpointBytes(captured?.battery) : null;
      if (!snapshot || (saveMode === 'battery' && !battery)) throw issue('Current game progress could not be captured', 'ECHECKPOINTINVALID');
    } catch (reason) { return Promise.resolve(markFailure(reason)); }
    const work = async () => {
      const copies = await inspectRecovery({ variant });
      if (copies.status !== 'ok') return copies;
      try {
        const existing = claimId ? copies.pending.find(record => record.captureId === claimId) : null;
        let record;
        if (existing) {
          const same = (a, b) => a === b || (a && b && a.length === b.length && a.every((value, i) => value === b[i]));
          if (!same(existing.snapshot, snapshot) || !same(existing.battery, battery)) throw issue('This claim belongs to different game progress', 'ECHECKPOINTJOURNALCONFLICT');
          record = existing;
        } else {
          const input = { key, saveMode, snapshot, battery, expectedRevision: copies.inspection.currentRevision,
            previousCaptureId: copies.inspection.head?.captureId ?? null, captureId: claimId || makeId(), sessionId,
            sequence: ++sequence, createdAt: now(), provenance: copies.inspection.provenance, requiresRestoreVerification: true };
          const volatile = volatileCopies.get(gameKey) ?? new Map();
          volatile.set(input.captureId, input); volatileCopies.set(gameKey, volatile);
          record = await journal.put(input); forgetVolatile(gameKey, input.captureId);
        }
        pendingRecovery = [...copies.pending.filter(item => item.captureId !== record.captureId), record];
        if (copies.pending.some(item => item.captureId !== record.captureId)
          || record.expectedRevision !== copies.inspection.currentRevision) return recover('conflict', pendingRecovery);
        if (!allowExisting && copies.inspection.currentRevision !== null) return recover('confirmation', pendingRecovery);
        return selectRecovery({ type: 'local', captureId: record.captureId });
      } catch (reason) { return markFailure(reason); }
    };
    return track(gameKey, work());
  }
  function resetFromRecovery() {
    if (disposed) return Promise.resolve({ status: 'skipped' });
    if (!recoveryInspection) return Promise.resolve(markFailure(issue('Inspect recovery copies before starting fresh', 'ECHECKPOINTINVALID')));
    if (!recoveryReset) recoveryReset = {
      inspection: recoveryInspection, pending: [...pendingRecovery],
      payload: { expectedRevision: recoveryInspection.currentRevision, expectedHeadToken: recoveryInspection.headToken,
        sourceRevision: null, intent: 'reset', snapshot: null, battery: null,
        captureId: makeId(), sessionId, sequence: ++sequence, provenance: recoveryInspection.provenance },
    };
    restored = false; phase = 'resetting'; fault = null; publish();
    const work = async () => {
      try {
        if (!recoveryReset.acknowledgedHead) {
          const result = await client[recoveryReset.inspection.requiresRepair ? 'repairCheckpoint' : 'resetCheckpoint'](key, recoveryReset.payload);
          if (result.status !== 'ok') return markFailure(result);
          recoveryReset.acknowledgedHead = result.data.head;
        }
        await journal.archive(key, recoveryReset.pending);
        const remaining = await journal.list(key);
        if (remaining.length) return recover('conflict', remaining);
        head = recoveryReset.acknowledgedHead;
        description = { saveMode, provenance: recoveryReset.inspection.provenance, head };
        entries.length = 0; pendingRecovery = []; lastCaptureId = head.captureId;
        selection = null; recoveryReset = null; phase = 'idle'; fault = null; publish();
        return { status: 'ok', data: { head } };
      } catch (reason) { return markFailure(reason); }
    };
    return track(gameKey, work());
  }
  function resetProgress(captured) {
    if (!getState().canSave) return Promise.resolve({ status: 'skipped' });
    const saved = save(captured);
    restored = false; phase = 'resetting'; publish();
    const work = async () => {
      const result = await saved;
      if (result.status !== 'ok') return markFailure(result);
      try {
        const reset = await client.resetCheckpoint(key, { expectedRevision: head?.revision ?? null,
          captureId: makeId(), sessionId, sequence: ++sequence, provenance: description.provenance });
        if (reset.status !== 'ok') return markFailure(reset);
        head = reset.data.head; description = { ...description, head }; lastCaptureId = head.captureId;
        phase = 'idle'; fault = null; publish(); return reset;
      } catch (reason) { return markFailure(reason); }
    };
    return track(gameKey, work());
  }
  return { prepare, confirmRestored, save, retry, getState, inspectRecovery, selectRecovery, confirmRecoveryRestored, resetProgress, resetFromRecovery, prepareClaim,
    flush: captured => captured ? save(captured) : uploadTail.then(result => fault || result),
    getRecovery: () => ({ description, pending: pendingRecovery }),
    dispose() { disposed = true; phase = 'disposed'; },
  };
}
