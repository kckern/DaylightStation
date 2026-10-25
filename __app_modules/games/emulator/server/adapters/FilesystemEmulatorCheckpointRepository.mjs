import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { readBinaryFromPath, readDirectory, writeBinaryAtomic } from '#system/utils/FileIO.mjs';
import { IEmulatorCheckpointRepository } from '../application/ports/IEmulatorCheckpointRepository.mjs';
import { assertSafeSegment } from './emulatorFileSupport.mjs';
import { checkpointDirectory, withEmulatorSaveLock } from './emulatorSaveLock.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const validHash = value => typeof value === 'string' && HASH.test(value);
const KINDS = new Set(['save', 'baseline', 'import', 'recover', 'reset']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const invalid = (message) => fail('ECHECKPOINTINVALID', message);
const corrupt = (message) => fail('ECHECKPOINTCORRUPT', message);
const conflict = () => fail('ECHECKPOINTCONFLICT', 'Progress changed since this game was loaded');
function optionalBytes(file) {
  try { return readBinaryFromPath(file); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function parse(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw corrupt('Unreadable checkpoint metadata'); }
}
function identity(key) { return { system: key.system, user: key.user.toLowerCase(), gameId: key.gameId }; }
function artifact(bytes) { return bytes ? { hash: digest(bytes), bytes: bytes.length } : null; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Immutable content blobs and revision records, published by one durable head. */
export class FilesystemEmulatorCheckpointRepository extends IEmulatorCheckpointRepository {
  #root;
  constructor({ emulationDir } = {}) {
    super();
    if (!emulationDir) throw new Error('Checkpoint repository requires emulationDir');
    this.#root = emulationDir;
  }
  #directory(key) { return checkpointDirectory(this.#root, key); }
  #head(key) {
    const dir = this.#directory(key);
    const bytes = optionalBytes(path.join(dir, 'head.json'));
    if (!bytes) {
      let records;
      try { records = readDirectory(path.join(dir, 'revisions')); }
      catch (err) { if (err.code !== 'ENOENT') throw err; records = []; }
      if (records.length) throw corrupt('Checkpoint history exists but its current pointer is missing');
      return null;
    }
    const head = parse(bytes);
    if (head.schema !== 1 || !validId(head.revision) || !validHash(head.hash)) throw corrupt('Invalid checkpoint pointer');
    return head;
  }
  #record(key, reference) {
    if (!validId(reference.revision) || !validHash(reference.hash)) throw corrupt('Invalid revision reference');
    const bytes = optionalBytes(path.join(this.#directory(key), 'revisions', `${reference.revision}.json`));
    if (!bytes || digest(bytes) !== reference.hash) throw corrupt('Checkpoint revision is missing or damaged');
    const record = parse(bytes);
    if (record.schema !== 1 || record.revision !== reference.revision || !same(record.key, identity(key))
      || !KINDS.has(record.kind) || !record.artifacts
      || (record.parent !== null && (!record.parent || !validId(record.parent.revision) || !validHash(record.parent.hash)))) {
      throw corrupt('Invalid checkpoint revision');
    }
    return record;
  }
  #blob(key, descriptor) {
    if (descriptor === null) return null;
    if (!descriptor || !validHash(descriptor.hash) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1) {
      throw corrupt('Invalid checkpoint artifact');
    }
    const bytes = optionalBytes(path.join(this.#directory(key), 'blobs', `${descriptor.hash}.bin`));
    if (!bytes || bytes.length !== descriptor.bytes || digest(bytes) !== descriptor.hash) throw corrupt('Saved progress is missing or damaged');
    return bytes;
  }
  #materialize(key, record) {
    return { ...record, snapshot: this.#blob(key, record.artifacts.snapshot), battery: this.#blob(key, record.artifacts.battery) };
  }
  async protect(key) {
    return withEmulatorSaveLock(this.#root, key, () => {
      const file = path.join(this.#directory(key), 'protected.json');
      const existing = optionalBytes(file);
      if (existing) {
        if (parse(existing).schema !== 1) throw corrupt('Invalid checkpoint protection marker');
        return;
      }
      writeBinaryAtomic(file, Buffer.from(JSON.stringify({ schema: 1 })), { durable: true });
    });
  }
  getArtifactResource(key, kind) {
    const head = this.#head(key);
    if (!head) return null;
    const record = this.#record(key, head);
    const bytes = this.#blob(key, record.artifacts[kind]);
    if (!bytes) throw fail('ENOENT', 'No current save artifact');
    return Object.freeze({ size: bytes.length, mimeType: 'application/octet-stream', open: () => Readable.from([bytes]) });
  }
  async readMetadata(key) {
    const head = this.#head(key);
    return head ? this.#record(key, head) : null;
  }
  async read(key) {
    const head = this.#head(key);
    return head ? this.#materialize(key, this.#record(key, head)) : null;
  }
  async history(key) {
    let ref = this.#head(key);
    const records = [];
    const seen = new Set();
    while (ref) {
      if (seen.has(ref.revision)) throw corrupt('Checkpoint history contains a cycle');
      seen.add(ref.revision);
      const record = this.#record(key, ref);
      records.push(record);
      ref = record.parent;
    }
    return records;
  }
  async readRevision(key, revision) {
    assertSafeSegment(revision);
    const record = (await this.history(key)).find(item => item.revision === revision);
    if (!record) throw fail('ENOENT', 'Checkpoint revision not found in committed history');
    return this.#materialize(key, record);
  }
  #sealedReference(key, revision) {
    assertSafeSegment(revision);
    const bytes = optionalBytes(path.join(this.#directory(key), 'seals', `${revision}.json`));
    if (!bytes) throw corrupt('Checkpoint has no independent integrity seal');
    const reference = parse(bytes);
    if (reference.schema !== 1 || reference.revision !== revision || !validHash(reference.hash)) throw corrupt('Invalid checkpoint integrity seal');
    return reference;
  }
  async readRecoveryRevision(key, revision) {
    return this.#materialize(key, this.#record(key, this.#sealedReference(key, revision)));
  }
  #damagedProtection(key) {
    const bytes = optionalBytes(path.join(this.#directory(key), 'protected.json'));
    if (!bytes) return null;
    try { return parse(bytes).schema === 1 ? null : bytes; }
    catch (error) { if (error.code !== 'ECHECKPOINTCORRUPT') throw error; return bytes; }
  }
  async inspectRecovery(key) {
    const dir = this.#directory(key);
    const raw = optionalBytes(path.join(dir, 'head.json'));
    let current = null, damagedHead = false;
    try { const ref = this.#head(key); current = ref ? this.#record(key, ref) : null; }
    catch (error) { if (error.code !== 'ECHECKPOINTCORRUPT') throw error; damagedHead = true; }
    let files;
    try { files = readDirectory(path.join(dir, 'revisions')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
    const checkpoints = [];
    for (const file of files.sort()) {
      const revision = file.endsWith('.json') ? file.slice(0, -5) : null;
      if (!validId(revision)) continue;
      try {
        const record = this.#record(key, this.#sealedReference(key, revision));
        this.#materialize(key, record);
        checkpoints.push({ ...record, usable: true });
      } catch (error) {
        if (error.code !== 'ECHECKPOINTCORRUPT') throw error;
        checkpoints.push({ revision, usable: false, error: error.message });
      }
    }
    return { headToken: raw ? digest(raw) : 'missing', damagedHead, damagedProtection: !!this.#damagedProtection(key),
      requiresRepair: damagedHead || !!this.#damagedProtection(key), currentRevision: current?.revision ?? null,
      head: current, checkpoints };
  }
  async repairHead(key, payload) {
    const source = payload.sourceRevision ? await this.readRecoveryRevision(key, payload.sourceRevision) : null;
    if (!source && !['import', 'reset'].includes(payload.intent)) throw invalid('An explicit repair selection is required');
    const kind = source ? (source.kind === 'reset' ? 'reset' : 'recover') : payload.intent;
    return this.#commit(key, { ...payload, expectedRevision: source?.revision ?? null,
      snapshot: kind === 'reset' ? null : source ? source.snapshot : payload.snapshot,
      battery: kind === 'reset' ? null : source ? source.battery : payload.battery,
      kind, restoredFrom: source?.revision,
    }, { expectedHeadToken: payload.expectedHeadToken, sourceRevision: source?.revision ?? null });
  }
  commit(key, checkpoint) { return this.#commit(key, checkpoint); }
  async #commit(key, checkpoint, repair = null) {
    this.#directory(key); // validate before accepting or materializing anything
    const { expectedRevision, provenance, captureId, sessionId, sequence, kind = 'save' } = checkpoint;
    if ((expectedRevision !== null && !validId(expectedRevision)) || !Object.hasOwn(checkpoint, 'expectedRevision')
      || !validId(captureId) || !validId(sessionId) || !Number.isSafeInteger(sequence) || sequence < 0
      || !KINDS.has(kind) || !provenance || !validHash(provenance.romHash) || !provenance.core
      || !validId(provenance.core.name) || !validHash(provenance.core.bundleHash)
      || !Number.isSafeInteger(provenance.core.format) || provenance.core.format < 1) throw invalid('Invalid checkpoint metadata');
    const ownedBytes = (value) => {
      if (value == null) return null;
      if (!(value instanceof Uint8Array) || !value.length || value.length > 8 * 1024 * 1024) throw invalid('Invalid checkpoint bytes');
      return Buffer.from(value);
    };
    const snapshot = ownedBytes(checkpoint.snapshot);
    const battery = ownedBytes(checkpoint.battery);
    if (kind === 'reset' ? !!(snapshot || battery) : !(snapshot || battery)) throw invalid('Incomplete checkpoint');
    const artifacts = { snapshot: artifact(snapshot), battery: artifact(battery) };
    const sameRetry = current => current.sessionId === sessionId && current.sequence === sequence && current.kind === kind
      && (current.parent?.revision ?? null) === expectedRevision && same(current.provenance, provenance)
      && same(current.artifacts, artifacts) && current.restoredFrom === checkpoint.restoredFrom
      && current.repairToken === repair?.expectedHeadToken;
    return withEmulatorSaveLock(this.#root, key, () => {
      let head;
      if (repair) {
        const raw = optionalBytes(path.join(this.#directory(key), 'head.json'));
        let published = null;
        try { const ref = this.#head(key); published = ref ? this.#record(key, ref) : null; }
        catch (error) { if (error.code !== 'ECHECKPOINTCORRUPT') throw error; }
        if (published?.captureId === captureId) {
          if (!sameRetry(published)) throw conflict();
          return this.#materialize(key, published);
        }
        if ((raw ? digest(raw) : 'missing') !== repair.expectedHeadToken) throw conflict();
        let damaged = false;
        try { const ref = this.#head(key); if (ref) this.#record(key, ref); }
        catch (error) { if (error.code !== 'ECHECKPOINTCORRUPT') throw error; damaged = true; }
        const protectionDamage = this.#damagedProtection(key);
        if (!damaged && !protectionDamage) throw fail('ECHECKPOINTREQUIRED', 'Current metadata is healthy; use guarded recovery');
        if (protectionDamage) {
          writeBinaryAtomic(path.join(this.#directory(key), 'damaged', `protected-${digest(protectionDamage)}.json`), protectionDamage, { durable: true });
          writeBinaryAtomic(path.join(this.#directory(key), 'protected.json'), Buffer.from(JSON.stringify({ schema: 1 })), { durable: true });
        }
        head = repair.sourceRevision ? this.#sealedReference(key, repair.sourceRevision) : null;
        if (head && !same(this.#record(key, head).artifacts, artifacts)) throw corrupt('Selected recovery bytes changed');
        if (raw) writeBinaryAtomic(path.join(this.#directory(key), 'damaged', `head-${digest(raw)}.json`), raw, { durable: true });
      } else head = this.#head(key);
      const current = head ? this.#record(key, head) : null;
      // A lost HTTP response is retriable without creating a second checkpoint.
      if (current?.captureId === captureId) {
        if (!sameRetry(current)) throw conflict();
        return this.#materialize(key, current);
      }
      if ((head?.revision ?? null) !== expectedRevision) throw conflict();
      if (current?.sessionId === sessionId && current.sequence >= sequence) throw conflict();
      const dir = this.#directory(key);
      for (const [name, bytes] of Object.entries({ snapshot, battery })) {
        if (!bytes) continue;
        const file = path.join(dir, 'blobs', `${artifacts[name].hash}.bin`);
        const existing = optionalBytes(file);
        if (existing && digest(existing) !== artifacts[name].hash) {
          if (kind !== 'import') throw corrupt('An existing checkpoint artifact is damaged');
          writeBinaryAtomic(path.join(dir, 'damaged', 'blobs', artifacts[name].hash, `${digest(existing)}.bin`), existing, { durable: true });
          writeBinaryAtomic(file, bytes, { durable: true });
        } else if (!existing) writeBinaryAtomic(file, bytes, { durable: true });
        // Verify staged contents before publication; never publish a partial bundle.
        this.#blob(key, artifacts[name]);
      }
      const record = { schema: 1, revision: randomUUID(), parent: head, key: identity(key),
        createdAt: new Date().toISOString(), kind, captureId, sessionId, sequence,
        provenance: JSON.parse(JSON.stringify(provenance)), artifacts,
        ...(checkpoint.restoredFrom ? { restoredFrom: checkpoint.restoredFrom } : {}),
        ...(repair ? { repairToken: repair.expectedHeadToken } : {}),
      };
      const recordBytes = Buffer.from(JSON.stringify(record));
      writeBinaryAtomic(path.join(dir, 'revisions', `${record.revision}.json`), recordBytes, { durable: true });
      const nextHead = { schema: 1, revision: record.revision, hash: digest(recordBytes) };
      this.#record(key, nextHead);
      writeBinaryAtomic(path.join(dir, 'seals', `${record.revision}.json`), Buffer.from(JSON.stringify(nextHead)), { durable: true });
      writeBinaryAtomic(path.join(dir, 'head.json'), Buffer.from(JSON.stringify(nextHead)), { durable: true });
      return this.#materialize(key, record);
    });
  }
}
