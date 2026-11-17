import path from 'node:path';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { createHash } from 'node:crypto';
import { IWorkState } from '../application/ports/IWorkState.mjs';
import { assertWorkUser, emptyWorkState, applyWorkEvents, workHash, stableWorkJson, workError } from '../domain/workState.mjs';
const GENESIS = workHash([]);
const revision = (sequence, checksum) => sequence + ':' + checksum;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** One durable envelope is the transaction; YAML is only a rebuildable projection. */
export class JsonlWorkState extends IWorkState {
  #rootForUser;
  #authority;
  #io;
  #clock;
  #queues = new Map();
  #closed = false;
  constructor({
    rootForUser,
    authority,
    io = FileIO,
    clock = Date.now
  }) {
    super();
    if (typeof rootForUser !== 'function' || typeof authority?.assertWriter !== 'function' || typeof clock !== 'function') throw new TypeError('Work state dependencies required');
    this.#rootForUser = rootForUser;
    this.#authority = authority;
    this.#io = io;
    this.#clock = clock;
  }
  #root(username) {
    assertWorkUser(username);
    const root = this.#rootForUser(username);
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw workError('INVALID_WORK_ROOT');
    return root;
  }
  #readBytes(file) {
    try {
      return this.#io.readBinaryFromPath(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  #projection(username, view) {
    return {
      schema: 'work-projection/v1',
      username,
      sequence: view.sequence,
      checksum: view.checksum,
      revision: revision(view.sequence, view.checksum),
      state: view.state
    };
  }
  #validateEnvelope(envelope, username, view) {
    if (!envelope || envelope.schema !== 'work-state/v1' || envelope.username !== username || envelope.sequence !== view.sequence + 1 || envelope.previousChecksum !== view.checksum || typeof envelope.id !== 'string' || !envelope.id || envelope.id.length > 240 || view.transactions.has(envelope.id) || !Number.isFinite(envelope.at) || envelope.at < 0 || !Array.isArray(envelope.events)) throw workError('WORK_LEDGER_CORRUPT');
    const {
      checksum: provided,
      ...payload
    } = envelope;
    if (provided !== workHash(payload)) throw workError('WORK_LEDGER_CORRUPT');
    try {
      return applyWorkEvents(view.state, envelope.events, {
        username
      });
    } catch {
      throw workError('WORK_LEDGER_CORRUPT');
    }
  }
  #observe(username) {
    const root = this.#root(username),
      bytes = this.#readBytes(path.join(root, 'events.jsonl')),
      projectionBytes = this.#readBytes(path.join(root, 'state.yml'));
    let projection = null;
    if (projectionBytes) {
      try {
        projection = yaml.load(projectionBytes.toString('utf8'), {
          schema: yaml.JSON_SCHEMA
        });
      } catch {/* reported as projection conflict below */}
    }
    if (bytes === null && projectionBytes && (projection?.sequence !== 0 || stableWorkJson(projection?.state) !== stableWorkJson(emptyWorkState()))) throw workError('WORK_LEDGER_MISSING');
    const text = bytes?.toString('utf8') ?? '',
      last = text.lastIndexOf('\n'),
      prefix = last < 0 ? '' : text.slice(0, last + 1),
      tail = text.slice(last + 1);
    let state = emptyWorkState(),
      sequence = 0,
      checksum = GENESIS;
    const transactions = new Map();
    for (const line of prefix.split('\n').filter(Boolean)) {
      let envelope;
      try {
        envelope = JSON.parse(line);
      } catch {
        throw workError('WORK_LEDGER_CORRUPT');
      }
      state = this.#validateEnvelope(envelope, username, {
        state,
        sequence,
        checksum,
        transactions
      });
      sequence = envelope.sequence;
      checksum = envelope.checksum;
      transactions.set(envelope.id, envelope);
    }
    const view = {
      root,
      state,
      sequence,
      checksum,
      transactions,
      tail,
      tailBytes: tail ? bytes.subarray(Buffer.byteLength(prefix)) : Buffer.alloc(0),
      prefixBytes: Buffer.byteLength(prefix),
      projectionBytes
    };
    const expected = this.#projection(username, view);
    view.projectionMatches = projectionBytes ? stableWorkJson(projection) === stableWorkJson(expected) : sequence === 0;
    view.health = tail ? {
      available: false,
      recovering: true,
      reason: 'WORK_TORN_TAIL'
    } : !view.projectionMatches ? {
      available: false,
      recovering: true,
      reason: 'WORK_PROJECTION_MISMATCH'
    } : {
      available: true,
      recovering: false,
      reason: null
    };
    if (this.#authority.leaseLost) view.health = {
      available: false,
      recovering: false,
      reason: 'WORK_LEASE_LOST'
    };
    return view;
  }
  async read({
    username
  }) {
    assertWorkUser(username);
    try {
      const view = this.#observe(username);
      return {
        ...structuredClone(view.state),
        revision: revision(view.sequence, view.checksum),
        health: view.health
      };
    } catch (error) {
      return {
        ...emptyWorkState(),
        revision: 'unavailable',
        health: {
          available: false,
          recovering: false,
          reason: error.code ?? 'WORK_READ_FAILED'
        }
      };
    }
  }
  async #serialized(username, work) {
    const previous = this.#queues.get(username) ?? Promise.resolve(),
      running = previous.catch(() => {}).then(work),
      settled = running.catch(() => {});
    this.#queues.set(username, settled);
    try {
      return await running;
    } finally {
      if (this.#queues.get(username) === settled) this.#queues.delete(username);
    }
  }
  #assertOpen() {
    if (this.#closed) throw workError('WORK_CLOSED');
    if (this.#authority.leaseLost) throw workError('WORK_LEASE_LOST');
  }
  #envelope(username, id, events, asOf, view) {
    const value = {
      schema: 'work-state/v1',
      username,
      id,
      sequence: view.sequence + 1,
      at: asOf,
      previousChecksum: view.checksum,
      events
    };
    return {
      ...value,
      checksum: workHash(value)
    };
  }
  #writeProjection(username, view) {
    this.#assertOpen();
    this.#io.saveYamlToPathAtomic(path.join(view.root, 'state.yml'), this.#projection(username, view), {
      durable: true
    });
  }
  async transact({
    username,
    id,
    expectedRevision,
    events,
    asOf
  }) {
    assertWorkUser(username);
    this.#assertOpen();
    if (typeof id !== 'string' || !id || id.length > 240 || !Number.isFinite(asOf) || asOf < 0) throw workError('INVALID_WORK_TRANSACTION');
    const captured = structuredClone(events);
    return this.#serialized(username, async () => {
      this.#assertOpen();
      const root = this.#root(username);
      await this.#authority.assertWriter({
        root
      });
      this.#assertOpen();
      const view = this.#observe(username),
        old = view.transactions.get(id);
      if (old) {
        if (stableWorkJson(old.events) !== stableWorkJson(captured)) throw workError('WORK_TRANSACTION_CONFLICT');
        if (!view.health.available) throw workError('WORK_STATE_UNAVAILABLE');
        return {
          applied: false,
          revision: revision(view.sequence, view.checksum)
        };
      }
      if (!view.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      if (expectedRevision !== revision(view.sequence, view.checksum)) throw workError('STALE_WORK_REVISION');
      const state = applyWorkEvents(view.state, captured, {
          username
        }),
        envelope = this.#envelope(username, id, captured, asOf, view);
      this.#assertOpen();
      this.#io.appendTextFile(path.join(root, 'events.jsonl'), JSON.stringify(envelope) + '\n', {
        durable: true
      });
      this.#writeProjection(username, {
        ...view,
        state,
        sequence: envelope.sequence,
        checksum: envelope.checksum
      });
      return {
        applied: true,
        revision: revision(envelope.sequence, envelope.checksum)
      };
    });
  }
  async recover({
    username
  }) {
    assertWorkUser(username);
    this.#assertOpen();
    return this.#serialized(username, async () => {
      const root = this.#root(username);
      await this.#authority.assertWriter({
        root
      });
      this.#assertOpen();
      let view = this.#observe(username),
        repairedBytes = 0;
      if (view.tail) {
        let parsed = false,
          envelope;
        try {
          envelope = JSON.parse(view.tail);
          parsed = true;
        } catch (error) {
          const message = String(error.message),
            position = Number(message.match(/position (\d+)/)?.[1]);
          if (!view.tail.trimStart().startsWith('{') || !(/Unexpected end|Unterminated string/.test(message) || Number.isFinite(position) && position >= view.tail.length - 1)) throw workError('WORK_LEDGER_CORRUPT');
        }
        if (parsed) {
          // A complete, valid envelope with only its final newline missing is retained.
          this.#validateEnvelope(envelope, username, view);
          this.#io.appendTextFile(path.join(root, 'events.jsonl'), '\n', {
            durable: true
          });
        } else {
          const tailDigest = digest(view.tailBytes),
            repairFile = path.join(root, 'repairs', 'tail-' + tailDigest + '.bin');
          this.#io.writeBinaryAtomic(repairFile, view.tailBytes, {
            durable: true
          });
          repairedBytes = view.tailBytes.length;
          this.#io.truncateFile(path.join(root, 'events.jsonl'), view.prefixBytes);
          this.#io.appendTextFile(path.join(root, 'events.jsonl'), '', {
            durable: true
          });
          const envelope = this.#envelope(username, 'recovery.tail:' + view.sequence + ':' + tailDigest, [{
            type: 'recovery.tail',
            bytes: repairedBytes,
            digest: tailDigest
          }], this.#clock(), view);
          this.#io.appendTextFile(path.join(root, 'events.jsonl'), JSON.stringify(envelope) + '\n', {
            durable: true
          });
        }
        view = this.#observe(username);
      }
      if (!view.projectionMatches && view.projectionBytes) {
        const checksum = digest(view.projectionBytes);
        this.#io.writeBinaryAtomic(path.join(root, 'repairs', 'projection-' + checksum + '.yml'), view.projectionBytes, {
          durable: true
        });
      }
      this.#writeProjection(username, view);
      return {
        repairedBytes,
        revision: revision(view.sequence, view.checksum)
      };
    });
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#authority.close?.();
    await Promise.allSettled([...this.#queues.values()]);
  }
}
