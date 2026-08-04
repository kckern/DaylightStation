import {
  Ti86NativeToolMapper,
  TI86_NATIVE_SNAPSHOT_RESOURCE,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86NativeToolMapper.mjs';
import {
  TI86_NATIVE_SNAPSHOT_VARIABLE,
  decodeTi86NativeSnapshot,
  encodeTi86NativeSnapshot,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86NativeSnapshotCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  SCHOOLCALC_LOCAL_STATE_SLOTS,
  prepareSchoolCalcLocalStateSave,
  selectSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';

export const TI86_NATIVE_POST_SNAPSHOT_MIN_FREE_BYTES = TI86_SCHOOLCALC_LIMITS.freeReserveBytes
  - TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes
  - TI86_SCHOOLCALC_LIMITS.variableOverheadBytes;

/**
 * Durable reference transaction for the calculator-side native runtime.
 *
 * The injected store is the seam later implemented by TI-OS variable and
 * capability adapters. Its required synchronous methods are:
 * read/write/deleteVariable and read/write/deleteNativeResource. Optional
 * getFreeBytes enables the same fail-closed transient-memory gate on host and
 * calculator. `applyPlan` receives a resource facade that cannot mutate any
 * resource omitted from the already-committed snapshot.
 */
export class Ti86NativeHandoffTransaction {
  #store;
  #planMapper;

  constructor({ store, programs = {} }) {
    for (const method of [
      'readVariable', 'writeVariable', 'deleteVariable',
      'readNativeResource', 'writeNativeResource', 'deleteNativeResource',
    ]) {
      if (!store || typeof store[method] !== 'function') {
        throw new Error(`TI-86 native handoff store requires ${method}`);
      }
    }
    this.#store = store;
    this.#planMapper = new Ti86NativeToolMapper({ programs });
  }

  /** Commit snapshot + continuation, apply configuration, then authorize launch. */
  prepare(plan, { applyPlan } = {}) {
    const normalized = this.#planMapper.decode(plan);
    if (typeof applyPlan !== 'function') throw new Error('TI-86 native handoff requires applyPlan');
    let selection = this.#selection();
    if (selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending) {
      throw new Error('TI-86 native handoff is already pending recovery');
    }
    if (selection.state.generation >= 0xFFFF_FFFE) {
      throw new Error('TI-86 native handoff cannot exhaust local-state generation');
    }

    const snapshotGeneration = selection.state.generation + 1;
    const entries = normalized.resources.map((resource) => {
      const current = this.#store.readNativeResource(resource);
      return current == null
        ? { resource, present: false, bytes: Buffer.alloc(0) }
        : { resource, present: true, bytes: Buffer.from(current) };
    });
    const snapshot = encodeTi86NativeSnapshot({
      generation: snapshotGeneration,
      capability: normalized.capability,
      entries,
    });
    this.#assertSnapshotSpace(snapshot.length);

    // Snapshot bytes are durable before SCL1 can point at them. An orphan
    // caused by a cut here is harmless and removed on the next normal launch.
    this.#store.writeVariable(TI86_NATIVE_SNAPSHOT_VARIABLE, snapshot);
    selection = this.#saveLocal(selection, {
      flags: (selection.state.flags | SCHOOLCALC_LOCAL_FLAGS.nativePending)
        & ~SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded,
      native: {
        capability: normalized.capability,
        phase: 'snapshotCommitted',
        snapshotGeneration,
      },
    });

    const allowed = new Set(normalized.resources);
    const resourceFacade = Object.freeze({
      read: (resource) => {
        assertAllowedResource(resource, allowed);
        const bytes = this.#store.readNativeResource(resource);
        return bytes == null ? null : Buffer.from(bytes);
      },
      write: (resource, bytes) => {
        assertAllowedResource(resource, allowed);
        this.#store.writeNativeResource(resource, Buffer.from(bytes));
      },
      delete: (resource) => {
        assertAllowedResource(resource, allowed);
        this.#store.deleteNativeResource(resource);
      },
    });
    applyPlan(Object.freeze({
      operation: normalized.operation,
      launch: normalized.launch,
      payload: Buffer.from(normalized.payload),
      decoded: normalized.decoded,
      resources: resourceFacade,
    }));

    selection = this.#saveLocal(selection, {
      flags: selection.state.flags & ~SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded,
      native: { ...selection.state.native, phase: 'configured' },
    });
    selection = this.#saveLocal(selection, {
      flags: selection.state.flags | SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded,
      native: { ...selection.state.native, phase: 'restorePending' },
    });

    // Tail-transfer is outside this transaction. A caller may enter TI-OS only
    // after receiving this return value, which proves restorePending is durable.
    return Object.freeze({
      operation: normalized.operation,
      launch: normalized.launch,
      payload: Buffer.from(normalized.payload),
      decoded: normalized.decoded,
      snapshotGeneration,
    });
  }

  /** Restore original resources idempotently and then clear continuation. */
  recover() {
    let selection = this.#selection();
    if (!(selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending)) {
      const orphanRemoved = this.#store.readVariable(TI86_NATIVE_SNAPSHOT_VARIABLE) != null;
      if (orphanRemoved) {
        this.#store.deleteVariable(TI86_NATIVE_SNAPSHOT_VARIABLE);
      }
      return Object.freeze({ recovered: false, orphanRemoved });
    }

    const encoded = this.#store.readVariable(TI86_NATIVE_SNAPSHOT_VARIABLE);
    if (encoded == null) throw new Error('TI-86 native recovery snapshot is missing');
    const snapshot = decodeTi86NativeSnapshot(encoded);
    if (snapshot.generation !== selection.state.native.snapshotGeneration) {
      throw new Error('TI-86 native recovery snapshot generation does not match continuation');
    }
    if (snapshot.capability !== selection.state.native.capability) {
      throw new Error('TI-86 native recovery snapshot capability does not match continuation');
    }

    if (selection.state.native.phase !== 'restorePending'
        || !(selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded)) {
      selection = this.#saveLocal(selection, {
        flags: selection.state.flags | SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded,
        native: { ...selection.state.native, phase: 'restorePending' },
      });
    }

    for (const entry of snapshot.entries) {
      if (entry.present) this.#store.writeNativeResource(entry.resource, entry.bytes);
      else this.#store.deleteNativeResource(entry.resource);
    }

    selection = this.#saveLocal(selection, {
      flags: selection.state.flags
        & ~SCHOOLCALC_LOCAL_FLAGS.nativePending
        & ~SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded,
      native: { capability: 'none', phase: 'none', snapshotGeneration: 0 },
    });
    this.#store.deleteVariable(TI86_NATIVE_SNAPSHOT_VARIABLE);
    return Object.freeze({
      recovered: true,
      orphanRemoved: false,
      snapshotGeneration: snapshot.generation,
      resources: Object.freeze(snapshot.entries.map((entry) => entry.resource)),
      continuation: selection.state,
    });
  }

  inspect() {
    const selection = this.#selection();
    const encoded = this.#store.readVariable(TI86_NATIVE_SNAPSHOT_VARIABLE);
    let snapshot = null;
    let snapshotError = null;
    if (encoded != null) {
      try { snapshot = decodeTi86NativeSnapshot(encoded); }
      catch (error) { snapshotError = error.message; }
    }
    return Object.freeze({ selection, snapshot, snapshotError });
  }

  #selection() {
    return selectSchoolCalcLocalState(Object.fromEntries(
      SCHOOLCALC_LOCAL_STATE_SLOTS.map((name) => [name, this.#store.readVariable(name)]),
    ));
  }

  #saveLocal(selection, patch) {
    const save = prepareSchoolCalcLocalStateSave(selection, patch);
    this.#store.writeVariable(save.targetSlot, save.bytes);
    return this.#selection();
  }

  #assertSnapshotSpace(snapshotBytes) {
    if (typeof this.#store.getFreeBytes !== 'function') return;
    const required = snapshotBytes
      + TI86_SCHOOLCALC_LIMITS.variableOverheadBytes
      + TI86_NATIVE_POST_SNAPSHOT_MIN_FREE_BYTES;
    const free = this.#store.getFreeBytes();
    if (!Number.isInteger(free) || free < required) {
      throw new Error(`TI-86 native handoff needs ${required} free bytes before snapshot; ${free} available`);
    }
  }
}

/** Deterministic host store with after-mutation power-cut injection. */
export class Ti86NativeMemoryStore {
  #variables;
  #resources;
  #freeBytes;
  #failAfter = null;
  #mutationCount = 0;
  #mutationLog = [];

  constructor({ variables = {}, resources = {}, freeBytes = TI86_SCHOOLCALC_LIMITS.freeReserveBytes } = {}) {
    this.#variables = bufferMap(variables);
    this.#resources = bufferMap(resources);
    this.#freeBytes = freeBytes;
  }

  readVariable(name) { return clone(this.#variables.get(name)); }
  writeVariable(name, bytes) {
    assertVariableName(name);
    this.#variables.set(name, Buffer.from(bytes));
    this.#mutated(`variable.write:${name}`);
  }
  deleteVariable(name) {
    assertVariableName(name);
    this.#variables.delete(name);
    this.#mutated(`variable.delete:${name}`);
  }
  readNativeResource(name) {
    assertResourceName(name);
    return clone(this.#resources.get(name));
  }
  writeNativeResource(name, bytes) {
    assertResourceName(name);
    this.#resources.set(name, Buffer.from(bytes));
    this.#mutated(`resource.write:${name}`);
  }
  deleteNativeResource(name) {
    assertResourceName(name);
    this.#resources.delete(name);
    this.#mutated(`resource.delete:${name}`);
  }
  getFreeBytes() { return this.#freeBytes; }
  setFreeBytes(value) { this.#freeBytes = value; }
  failAfterMutation(count) {
    if (!Number.isInteger(count) || count < 1) throw new Error('power-cut mutation must be positive');
    this.#failAfter = count;
    this.#mutationCount = 0;
  }
  clearFault() { this.#failAfter = null; this.#mutationCount = 0; }
  mutationLog() { return Object.freeze([...this.#mutationLog]); }
  dump() {
    return Object.freeze({
      variables: objectFromBufferMap(this.#variables),
      resources: objectFromBufferMap(this.#resources),
    });
  }

  #mutated(label) {
    this.#mutationCount += 1;
    this.#mutationLog.push(label);
    if (this.#failAfter === this.#mutationCount) {
      throw new Ti86NativePowerCutError(`simulated power cut after ${label}`);
    }
  }
}

export class Ti86NativePowerCutError extends Error {
  constructor(message) { super(message); this.name = 'Ti86NativePowerCutError'; }
}

function assertAllowedResource(resource, allowed) {
  assertResourceName(resource);
  if (!allowed.has(resource)) throw new Error(`TI-86 native plan tried to mutate unsnapshotted resource '${resource}'`);
}

function assertResourceName(name) {
  if (!Object.hasOwn(TI86_NATIVE_SNAPSHOT_RESOURCE, name)) {
    throw new Error(`unknown TI-86 native resource '${name}'`);
  }
}

function assertVariableName(name) {
  if (typeof name !== 'string' || !/^[A-Z][A-Z0-9]{0,7}$/.test(name)) {
    throw new Error(`invalid TI-86 variable name '${name}'`);
  }
}

function bufferMap(value) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return new Map(entries.map(([name, bytes]) => [name, Buffer.from(bytes)]));
}

function objectFromBufferMap(map) {
  return Object.freeze(Object.fromEntries([...map.entries()].map(([name, bytes]) => [name, Buffer.from(bytes)])));
}

function clone(value) { return value == null ? null : Buffer.from(value); }

export default Ti86NativeHandoffTransaction;
